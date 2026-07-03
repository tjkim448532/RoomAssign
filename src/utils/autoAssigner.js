/**
 * 지능형 객실 배정 알고리즘
 * @param {Array} reservations - Vercel에서 받아온 예약 리스트 (AI 선호도 분석 포함)
 * @param {Array} currentRooms - 현재 객실 인벤토리 상태
 * @returns {Object} { assignments: [], logs: [] }
 */
export async function runAutoAssignment(reservations, currentRooms) {
  const assignments = [];
  const logs = [];
  const availableRooms = JSON.parse(JSON.stringify(currentRooms)).filter(r => r.status === 'available' || r.status === 'checkout');

  logs.push(`자동 배정 엔진 시작: 총 ${reservations.length}건의 예약을 처리합니다.`);
  
  // 0. 로컬 우선순위 정렬: 회원(is_member) > 골프예약(has_golf) 순으로 먼저 배정 기회 부여
  const sortedReservations = [...reservations].sort((a, b) => {
    const aScore = (a.is_member ? 2 : 0) + (a.has_golf ? 1 : 0);
    const bScore = (b.is_member ? 2 : 0) + (b.has_golf ? 1 : 0);
    return bScore - aScore; // 내림차순 (점수가 높은 사람이 먼저 배정)
  });

  for (const res of sortedReservations) {
    if (res.assignedRoom) {
      logs.push(`[건너뜀] ${res.customerName} 고객님은 이미 배정되었습니다 (${res.assignedRoom}).`);
      continue;
    }

    logs.push(`---`);
    logs.push(`[진행중] ${res.customerName} 고객님 (${res.roomType}) 분석 시작...`);
    
    // 1. AI 선호도 분석 결과 (Vercel 엔진에서 받아온 값)
    const prefs = res.preferences || {
      wantsHighFloor: false, wantsLowFloor: false, needsAccessible: false, isConnectingRequired: false, otherKeywords: []
    };
    logs.push(`  └ AI 분석 결과: ${JSON.stringify(prefs)}`);

    // 2. 타입에 맞는 빈 방 필터링 (강제 조건 덮어쓰기 로직 추가)
    const rawType = prefs.forcedSize || res.roomType;
    const effectiveRoomType = rawType.replace('평', 'P'); // "16평" -> "16P"로 변환
    
    let candidateRooms = availableRooms.filter(r => {
      // 강제 평형 적용 시, 원래 51P 예약이 아니어도 51P처럼 동작해야 할 수 있으나
      // 복잡하므로 일단 effectiveRoomType 기준으로 size 매칭
      if (effectiveRoomType === '51P') {
        if (!r.isConnecting) return false;
        const adjacentRoom = availableRooms.find(ar => ar.roomNumber === r.adjacent);
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
    const guestNotes = res.notes || '';
    candidateRooms.forEach(room => {
      let score = 0;
      if ((guestNotes.includes('조용') || guestNotes.includes('소음')) && room.features?.includes('조용함')) score += 10;
      if ((guestNotes.includes('경치') || guestNotes.includes('뷰') || guestNotes.includes('전망')) && room.features?.includes('경치좋음')) score += 10;
      if ((guestNotes.includes('채광') || guestNotes.includes('햇빛') || guestNotes.includes('밝은')) && room.features?.includes('채광좋음')) score += 10;
      if ((guestNotes.includes('엘리베이터') || guestNotes.includes('가까운') || guestNotes.includes('걷기')) && room.features?.includes('엘리베이터가까움')) score += 10;
      if ((guestNotes.includes('넓은') || guestNotes.includes('큰방') || guestNotes.includes('큰 방')) && room.features?.includes('넓은객실')) score += 10;
      
      room.matchScore = score;
    });

    // 4. 선호도에 따른 정렬/선택
    candidateRooms.sort((a, b) => {
      // 1순위: 장애인 객실 우선 배정 (조건 충족 시)
      if (prefs.needsAccessible) {
        if (a.isDisabled && !b.isDisabled) return -1;
        if (!a.isDisabled && b.isDisabled) return 1;
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
    if (selectedRoom.matchScore > 0) {
      logs.push(`  └ ✨ AI 특징 매칭: 고객 메모 분석을 통해 가장 알맞은 특성(${selectedRoom.features.join(', ')})을 가진 ${selectedRoom.roomNumber}호 배정`);
    }

    // 4. 배정 확정 및 51평 연동 처리
    if (effectiveRoomType === '51P') {
      const adjacentRoom = availableRooms.find(r => r.roomNumber === selectedRoom.adjacent);
      assignments.push({
        reservationId: res.reservationId,
        customerName: res.customerName,
        assignedRooms: [selectedRoom.id, adjacentRoom.id],
        type: '51P'
      });
      logs.push(`  ✅ [배정 성공] 51평형(락오프): ${selectedRoom.roomNumber}호 + ${adjacentRoom.roomNumber}호 통합 배정 완료`);
      
      // 인벤토리에서 제외
      availableRooms.splice(availableRooms.findIndex(r => r.id === selectedRoom.id), 1);
      availableRooms.splice(availableRooms.findIndex(r => r.id === adjacentRoom.id), 1);
    } else {
      assignments.push({
        reservationId: res.reservationId,
        customerName: res.customerName,
        assignedRooms: [selectedRoom.id],
        type: effectiveRoomType
      });
      logs.push(`  ✅ [배정 성공] ${selectedRoom.roomNumber}호 배정 완료`);
      
      // 인벤토리에서 제외
      availableRooms.splice(availableRooms.findIndex(r => r.id === selectedRoom.id), 1);
    }
  }

  logs.push(`---`);
  logs.push(`자동 배정 엔진 종료. 총 ${assignments.length}건 배정 완료.`);
  return { assignments, logs };
}
