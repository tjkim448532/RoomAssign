/**
 * 지능형 객실 배정 알고리즘
 * @param {Array} reservations - Vercel에서 받아온 예약 리스트 (AI 선호도 분석 포함)
 * @param {Array} currentRooms - 현재 객실 인벤토리 상태
 * @returns {Object} { assignments: [], logs: [] }
 */
export async function runAutoAssignment(reservations, currentRooms) {
  const assignments = [];
  const logs = [];
  const groupBuildingMap = {}; // 그룹명 -> 배정된 첫 동 번호
  
  // 0-1. 이미 배정된(연박 중 등) 객실 번호 수집하여 보호
  const alreadyAssignedRoomIds = [];
  reservations.forEach(res => {
    if (res.assignedRoom) {
      // 콤마로 구분된 여러 방 ID (e.g., "101-201, 101-202")를 각각 분리해서 추가
      const ids = res.assignedRoom.split(',').map(s => s.trim());
      ids.forEach(id => {
        if (id) alreadyAssignedRoomIds.push(id);
      });
    }
  });

  // 0-2. 상태가 available/checkout 인 방 중에서 연박/기배정 방은 풀에서 제외
  let availableRooms = JSON.parse(JSON.stringify(currentRooms)).filter(r => r.status === 'available' || r.status === 'checkout');
  if (alreadyAssignedRoomIds.length > 0) {
    logs.push(`[시스템] 연박/기배정으로 인해 보호되는 객실 ID: ${[...new Set(alreadyAssignedRoomIds)].join(', ')}`);
    // id 기준으로 정확하게 매칭해서 보호
    availableRooms = availableRooms.filter(r => !alreadyAssignedRoomIds.includes(r.id));
  }

  logs.push(`자동 배정 엔진 시작: 총 ${reservations.length}건의 예약을 처리합니다.`);
  
  // 0-3. 동일인(customerName) 다중 예약 시 자동 그룹화 처리
  const customerCountMap = {};
  reservations.forEach(r => {
    if (r.customerName) {
      customerCountMap[r.customerName] = (customerCountMap[r.customerName] || 0) + 1;
    }
  });

  reservations.forEach(r => {
    // 2개 이상 예약한 동일인인데 그룹명이 없는 경우, 고객명을 그룹명으로 자동 지정
    if (r.customerName && customerCountMap[r.customerName] > 1 && !r.group_name && !r.groupName) {
      r.group_name = r.customerName; 
    }
  });
  
  // 0. 전체 우선순위 정렬: VIP(isVip/is_vip) > 방문횟수(visitCount/visit_count) > 회원(is_member) > 골프(teeOffTime/tee_off_time/has_golf)
  const sortedReservations = [...reservations].sort((a, b) => {
    const aVip = a.isVip || a.is_vip;
    const aVisit = a.visitCount || a.visit_count || 0;
    const aTeeOff = a.teeOffTime || a.tee_off_time || a.has_golf;
    const aScore = (aVip ? 50 : 0) + (aVisit * 2) + (a.is_member ? 2 : 0) + (aTeeOff ? 1 : 0);
    
    const bVip = b.isVip || b.is_vip;
    const bVisit = b.visitCount || b.visit_count || 0;
    const bTeeOff = b.teeOffTime || b.tee_off_time || b.has_golf;
    const bScore = (bVip ? 50 : 0) + (bVisit * 2) + (b.is_member ? 2 : 0) + (bTeeOff ? 1 : 0);
    
    return bScore - aScore; // 내림차순 (점수가 높은 사람이 먼저 배정)
  });

  for (const res of sortedReservations) {
    // 이미 DB(예약)에 방이 할당되어 있거나, 수기 배정 등으로 객실 노트에 고객명이 기입된 경우 보호/건너뜀
    const isManuallyAssigned = currentRooms.some(r => r.notes && r.notes.includes(res.customerName));
    if (res.assignedRoom || isManuallyAssigned) {
      logs.push(`[건너뜀] ${res.customerName} 고객님은 이미 배정되었습니다 (${res.assignedRoom || '수기 배정'}).`);
      continue;
    }

    logs.push(`---`);
    logs.push(`[진행중] ${res.customerName} 고객님 (${res.roomType}) 분석 시작...`);
    
    // 1. AI 선호도 분석 결과 (Vercel 엔진에서 받아온 값)
    const prefs = res.preferences || {
      wantsHighFloor: false, wantsLowFloor: false, needsAccessible: false, isConnectingRequired: false, otherKeywords: []
    };
    
    // DB에서 파싱해준 Flag 우선 적용
    if (res.reqHighFloor || res.req_high_floor) prefs.wantsHighFloor = true;
    
    // 비고(메모) 기반 자연어 추가 분석 (AI 엔진 오프라인 대비 또는 보완)
    const guestNotes = res.notes || '';
    if (guestNotes.includes('고층') || guestNotes.includes('높은층') || guestNotes.includes('높은 층')) prefs.wantsHighFloor = true;
    if (guestNotes.includes('저층') || guestNotes.includes('낮은층') || guestNotes.includes('낮은 층') || guestNotes.includes('1층')) prefs.wantsLowFloor = true;
    if (guestNotes.includes('장애인') || guestNotes.includes('휠체어')) prefs.needsAccessible = true;

    // 단체(그룹) 일괄 배정 로직: 같은 그룹은 가급적 같은 동에 배정
    const groupName = res.group_name || res.groupName;
    if (groupName && !prefs.forcedBuilding && (guestNotes.includes('같은동') || guestNotes.includes('같은 동') || guestNotes.includes('인접') || guestNotes.includes('모여'))) {
      const groupKey = groupName;
      if (groupBuildingMap[groupKey]) {
        prefs.forcedBuilding = groupBuildingMap[groupKey];
        logs.push(`  └ 단체 자연어 분석: "같은동" 요청 반영 -> [${prefs.forcedBuilding}동] 강제 지정`);
      }
    }

    logs.push(`  └ 통합 분석 결과: ${JSON.stringify(prefs)}`);

    // 2. 타입에 맞는 빈 방 필터링 (강제 조건 덮어쓰기 로직 추가)
    const rawType = prefs.forcedSize || res.roomType;
    const effectiveRoomType = rawType.replace('평', 'P'); // "16평" -> "16P"로 변환
    
    let candidateRooms = availableRooms.filter(r => {
      // 강제 평형 적용 시, 원래 51P 예약이 아니어도 51P처럼 동작해야 할 수 있으나
      // 복잡하므로 일단 effectiveRoomType 기준으로 size 매칭
      if (effectiveRoomType === '51P') {
        if (!r.isConnecting) return false;
        // 같은 동(building)에 있는 인접 객실(adjacent)인지 확인
        const adjacentRoom = availableRooms.find(ar => ar.roomNumber === r.adjacent && ar.building === r.building);
        return adjacentRoom !== undefined;
      }
      return r.size === effectiveRoomType;
    });

    // 2-1. 관리자 강제 규칙(동, 호수) 필터링 추가
    if (prefs.forcedBuilding) {
      candidateRooms = candidateRooms.filter(r => r.building === prefs.forcedBuilding || r.roomNumber.startsWith(prefs.forcedBuilding));
      logs.push(`  └ 관리자 규칙: [${prefs.forcedBuilding}동]으로 필터링`);
    }
    
    if (prefs.forcedRoom) {
      candidateRooms = candidateRooms.filter(r => r.roomNumber === prefs.forcedRoom);
      logs.push(`  └ 관리자 규칙: [${prefs.forcedRoom}호]로 지정`);
    }

    if (candidateRooms.length === 0) {
      logs.push(`  ❌ [배정 실패] 조건에 맞는 ${effectiveRoomType} 빈 방이 없습니다.`);
      continue;
    }

    // 3. 특징 매칭 스코어링
// guestNotes already defined earlier
    candidateRooms.forEach(room => {
      let score = 0;
      const roomFeatures = room.room_features || room.features || [];
      const quietReq = res.reqQuiet || res.req_quiet || guestNotes.includes('조용') || guestNotes.includes('소음');
      if (quietReq && roomFeatures.includes('조용함')) score += 10;
      
      const viewReq = guestNotes.includes('경치') || guestNotes.includes('뷰') || guestNotes.includes('전망');
      if (viewReq && roomFeatures.includes('경치좋음')) score += 10;
      
      const lightReq = guestNotes.includes('채광') || guestNotes.includes('햇빛') || guestNotes.includes('밝은');
      if (lightReq && roomFeatures.includes('채광좋음')) score += 10;
      
      const elevatorReq = res.reqNearElevator || res.req_near_elevator || guestNotes.includes('엘리베이터') || guestNotes.includes('엘베') || guestNotes.includes('가까운');
      if (elevatorReq && roomFeatures.includes('엘리베이터가까움')) score += 10;
      
      if ((guestNotes.includes('넓은') || guestNotes.includes('큰방') || guestNotes.includes('큰 방')) && roomFeatures.includes('넓은객실')) score += 10;
      if ((guestNotes.includes('트윈') || guestNotes.includes('침대 2개') || guestNotes.includes('침대두개')) && room.bedType && room.bedType.includes('+')) score += 15;
      
      // 단체 및 동일인 다중 예약 배정: 가급적 같은 동에 모이도록 강력한 가산점 부여
      if (groupName && groupBuildingMap[groupName] === room.building) {
        score += 100;
      }

      room.matchScore = score;
    });

    // 4. 선호도에 따른 정렬/선택
    candidateRooms.sort((a, b) => {
      // 1순위: 장애인 객실 우선 배정 (조건 충족 시)
      if (prefs.needsAccessible) {
        const aHandicap = a.is_handicap_accessible || a.isDisabled;
        const bHandicap = b.is_handicap_accessible || b.isDisabled;
        if (aHandicap && !bHandicap) return -1;
        if (!aHandicap && bHandicap) return 1;
      }

      // 2순위: 특징 매칭 점수
      if (b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      
      // 3순위: 층수 선호도
      if (prefs.wantsHighFloor) {
        return b.roomNumber.localeCompare(a.roomNumber);
      } else if (prefs.wantsLowFloor) {
        return a.roomNumber.localeCompare(b.roomNumber);
      }
      return 0;
    });

    const selectedRoom = candidateRooms[0];
    // Build AI reason string
    let aiReason = '';
    if (prefs.forcedBuilding) {
      aiReason = `동 ${prefs.forcedBuilding} 강제 지정`;
    } else if (prefs.forcedRoom) {
      aiReason = `호 ${prefs.forcedRoom} 강제 지정`;
    } else if (groupName) {
      aiReason = `그룹 ${groupName} 동일동 배정`;
    } else if (selectedRoom.matchScore > 0) {
      const roomFeatures = selectedRoom.room_features || selectedRoom.features || [];
      const featureList = roomFeatures.join(', ') || selectedRoom.bedType;
      aiReason = `특징 매칭 (${featureList})`;
    } else {
      aiReason = '일반 배정';
    }
    if (selectedRoom.matchScore > 0) {
      logs.push(`  └ ✨ AI 특징 매칭: ${aiReason} - ${selectedRoom.roomNumber}호`);
    } else {
      logs.push(`  └ ✨ AI 배정: ${aiReason} - ${selectedRoom.roomNumber}호`);
    }

    // Detect special tags
    const tags = [];
    const noteLower = (res.notes || '').toLowerCase();
    if (noteLower.includes('vip')) tags.push('VIP');
    if (noteLower.includes('complaint') || noteLower.includes('주의')) tags.push('주의');
    if (noteLower.match(/(\d{1,2}:\d{2})|early|얼리|14시|13시|12시/)) tags.push('청소긴급');

    if (groupName && !groupBuildingMap[groupName]) {
      groupBuildingMap[groupName] = selectedRoom.building;
    }

    // 4. 배정 확정 및 51평 연동 처리
    if (effectiveRoomType === '51P') {
      // 같은 동(building)에 있는 인접 객실을 정확히 찾아 연동
      const adjacentRoom = availableRooms.find(r => r.roomNumber === selectedRoom.adjacent && r.building === selectedRoom.building);
        assignments.push({
          reservationId: res.reservationId,
          customerName: res.customerName,
          stayLength: res.stayLength || 1,
          checkInDate: res.checkInDate || new Date().toISOString(),
          assignedRooms: [selectedRoom.id, adjacentRoom.id],
          type: '51P',
          aiReason: aiReason,
          tags: tags,
          group_name: groupName
        });
        logs.push(`  ✅ [배정 성공] 51평형(락오프): ${selectedRoom.roomNumber}호 + ${adjacentRoom.roomNumber}호 통합 배정 완료 – ${aiReason}`);
      
      // 인벤토리에서 제외
      availableRooms.splice(availableRooms.findIndex(r => r.id === selectedRoom.id), 1);
      availableRooms.splice(availableRooms.findIndex(r => r.id === adjacentRoom.id), 1);
    } else {
      assignments.push({
      reservationId: res.reservationId,
      customerName: res.customerName,
      stayLength: res.stayLength || 1,
      checkInDate: res.checkInDate || new Date().toISOString(),
      assignedRooms: [selectedRoom.id],
      type: effectiveRoomType,
      aiReason: aiReason,
      tags: tags,
      group_name: groupName
    });
      logs.push(`  ✅ [배정 성공] ${selectedRoom.roomNumber}호 배정 완료 – ${aiReason}`);
      
      // 인벤토리에서 제외
      availableRooms.splice(availableRooms.findIndex(r => r.id === selectedRoom.id), 1);
    }
  }

  logs.push(`---`);
  logs.push(`자동 배정 엔진 종료. 총 ${assignments.length}건 배정 완료.`);
  return { assignments, logs };
}
