/**
 * 지능형 객실 배정 알고리즘 (V6 SSOT 고도화 버전)
 * @param {Array} reservations - Vercel에서 받아온 예약 리스트 (AI 선호도 분석 포함)
 * @param {Array} currentRooms - 현재 객실 인벤토리 상태
 * @returns {Object} { assignments: [], logs: [] }
 */
export async function runAutoAssignment(reservations, currentRooms) {
  const assignments = [];
  const logs = [];
  const groupBuildingMap = {}; // 그룹명 -> 배정된 첫 동 번호
  const groupAssignedRooms = {}; // 그룹명 -> 배정된 호수 리스트 (층/호수 인접 클러스터링용)

  // 장애인 전용 객실 표준 판별 헬퍼 (roomsData.json의 단독 51P 및 노트/플래그 통합 지원)
  const isHandicapRoom = (r) => Boolean(
    r.isDisabled ||
    r.is_handicap_accessible ||
    (r.notes && r.notes.includes('장애인')) ||
    (r.size === '51P' && !r.isConnecting)
  );

  // 객실 타입(평형) 정규화 추출 헬퍼
  const resolveRoomType = (res) => {
    const prefs = res.preferences || {};
    const guestNotes = res.notes || '';
    let rawType = prefs.forcedSize || res.roomType || res.room_type || res.type || res.size || '';

    if (!rawType && guestNotes) {
      const match = guestNotes.match(/(16|35|51)\s*(?:PY|P|평|인|형)/i);
      if (match) {
        rawType = match[1] + 'P';
      }
    }

    let effectiveRoomType = '';
    if (typeof rawType === 'string') {
      effectiveRoomType = rawType.replace(/평형|평|py/gi, 'P').trim().toUpperCase();
      if (/^(16|35|51)$/.test(effectiveRoomType)) {
        effectiveRoomType += 'P';
      }
    } else if (rawType) {
      effectiveRoomType = String(rawType).trim().toUpperCase();
      if (/^(16|35|51)$/.test(effectiveRoomType)) {
        effectiveRoomType += 'P';
      }
    }
    return { effectiveRoomType, extractedFromNotes: !res.roomType && !prefs.forcedSize && Boolean(effectiveRoomType) };
  };

  // 0-1. 이미 배정된(연박 중 등) 객실 번호 수집하여 보호 (예약 리스트 + 현재 객실 인벤토리 교차 검증)
  const alreadyAssignedRoomIds = new Set();
  reservations.forEach(res => {
    if (res.assignedRoom) {
      const ids = String(res.assignedRoom).split(',').map(s => s.trim());
      ids.forEach(id => {
        if (id) alreadyAssignedRoomIds.add(id);
      });
    }
  });

  currentRooms.forEach(r => {
    if (r.status === 'assigned' || r.reservationId || (r.customerName && String(r.customerName).trim())) {
      alreadyAssignedRoomIds.add(r.id);
    }
  });

  // 0-2. 상태가 available 인 방 중에서 연박/기배정 방은 풀에서 제외
  let availableRooms = JSON.parse(JSON.stringify(currentRooms)).filter(
    r => r.status === 'available' && !alreadyAssignedRoomIds.has(r.id)
  );
  if (alreadyAssignedRoomIds.size > 0) {
    logs.push(`[시스템] 연박/기배정으로 인해 보호되는 객실 수: ${alreadyAssignedRoomIds.size}실`);
  }

  logs.push(`자동 배정 엔진 시작: 총 ${reservations.length}건의 예약을 처리합니다.`);

  // 0-3. 동일인(customerName) 다중 예약 시 자동 그룹화 처리
  const customerCountMap = {};
  reservations.forEach(r => {
    const cName = (r.customerName || r.customer_name || '').trim();
    if (cName) {
      customerCountMap[cName] = (customerCountMap[cName] || 0) + 1;
    }
  });

  reservations.forEach(r => {
    const cName = (r.customerName || r.customer_name || '').trim();
    // 2개 이상 예약한 동일인인데 그룹명이 없는 경우, 고객명을 그룹명으로 자동 지정
    if (cName && customerCountMap[cName] > 1 && !r.group_name && !r.groupName) {
      r.groupName = cName;
    }
  });

  // 0-4. 단체(Group) 사전 수용량(Capacity) 스캔 및 최적 동(Building) 앵커링
  // (첫 방이 잔여 객실이 부족한 동에 배정되어 단체가 쪼개지는 현상 원천 방지)
  const groupNeedsMap = {};
  reservations.forEach(r => {
    const gName = r.groupName || r.group_name;
    if (!gName || r.assignedRoom) return;
    if (!groupNeedsMap[gName]) {
      groupNeedsMap[gName] = { total: 0, '16P': 0, '35P': 0, '51P': 0 };
    }
    const { effectiveRoomType } = resolveRoomType(r);
    groupNeedsMap[gName].total += 1;
    if (effectiveRoomType && groupNeedsMap[gName][effectiveRoomType] !== undefined) {
      groupNeedsMap[gName][effectiveRoomType] += 1;
    }
  });

  Object.entries(groupNeedsMap).forEach(([gName, needs]) => {
    if (needs.total < 2) return;
    // 이미 해당 그룹으로 배정된 객실이 인벤토리에 존재하는지 확인
    const existingGroupRoom = currentRooms.find(
      r => r.status === 'assigned' && (r.groupName === gName || r.group_name === gName)
    );
    if (existingGroupRoom) {
      groupBuildingMap[gName] = existingGroupRoom.building;
      groupAssignedRooms[gName] = currentRooms
        .filter(r => r.status === 'assigned' && (r.groupName === gName || r.group_name === gName))
        .map(r => parseInt(r.roomNumber, 10))
        .filter(n => !isNaN(n));
      return;
    }

    // 동별 가용 객실 스캔하여 단체 요구 수량을 가장 잘 수용하는 최적 동 선택
    const buildings = ['101', '102', '103', '104', '105'];
    let bestBuilding = null;
    let bestFitScore = -1;

    buildings.forEach(b => {
      const bRooms = availableRooms.filter(r => r.building === b && !isHandicapRoom(r));
      const avail16 = bRooms.filter(r => r.size === '16P').length;
      const avail35 = bRooms.filter(r => r.size === '35P').length;
      // 51P 커넥팅 가용 쌍 계산
      const avail51 = bRooms.filter(
        r => r.size === '35P' && r.isConnecting && bRooms.some(ar => ar.roomNumber === r.adjacent)
      ).length;

      const satisfied16 = Math.min(needs['16P'], avail16);
      const satisfied35 = Math.min(needs['35P'], avail35);
      const satisfied51 = Math.min(needs['51P'], avail51);
      const totalSatisfied = satisfied16 + satisfied35 + satisfied51;

      // 수용 가능 객실 수 * 100 + 해당 동 전체 여유 객실 수
      const fitScore = (totalSatisfied * 100) + bRooms.length;
      if (fitScore > bestFitScore) {
        bestFitScore = fitScore;
        bestBuilding = b;
      }
    });

    if (bestBuilding) {
      groupBuildingMap[gName] = bestBuilding;
      logs.push(`[단체 사전 스캔] '${gName}' 단체(총 ${needs.total}건) 최적 수용 동 ➔ [${bestBuilding}동] 자동 배정 예약`);
    }
  });

  // 0-5. 전체 우선순위 정렬: 51P(락오프 페어 보호) > 장애인/휠체어 > VIP > 방문횟수 > 회원 > 골프
  const sortedReservations = [...reservations].sort((a, b) => {
    const aTypeObj = resolveRoomType(a);
    const bTypeObj = resolveRoomType(b);
    const aIs51P = aTypeObj.effectiveRoomType === '51P';
    const bIs51P = bTypeObj.effectiveRoomType === '51P';
    if (aIs51P && !bIs51P) return -1;
    if (!aIs51P && bIs51P) return 1;

    const aAcc = Boolean(a.preferences?.needsAccessible || /장애인|휠체어/.test(a.notes || ''));
    const bAcc = Boolean(b.preferences?.needsAccessible || /장애인|휠체어/.test(b.notes || ''));
    if (aAcc && !bAcc) return -1;
    if (!aAcc && bAcc) return 1;

    const aVip = a.isVip ?? a.is_vip;
    const aVisit = (a.visitCount ?? a.visit_count) || 0;
    const aTeeOff = a.teeOffTime ?? a.tee_off_time ?? a.hasGolf ?? a.has_golf;
    const aScore = (aVip ? 50 : 0) + (aVisit * 2) + (a.isMember ?? a.is_member ? 2 : 0) + (aTeeOff ? 1 : 0);

    const bVip = b.isVip ?? b.is_vip;
    const bVisit = (b.visitCount ?? b.visit_count) || 0;
    const bTeeOff = b.teeOffTime ?? b.tee_off_time ?? b.hasGolf ?? b.has_golf;
    const bScore = (bVip ? 50 : 0) + (bVisit * 2) + (b.isMember ?? b.is_member ? 2 : 0) + (bTeeOff ? 1 : 0);

    return bScore - aScore; // 내림차순 (점수가 높은 사람이 먼저 배정)
  });

  for (const res of sortedReservations) {
    const customerName = (res.customerName || res.customer_name || '').trim();
    const displayName = customerName || res.reservationId || res.id || '무명 고객';

    // 이미 DB(예약)에 방이 할당되어 있거나, 수기 배정 등으로 객실 노트에 고객명이 기입된 경우 보호/건너뜀
    const isManuallyAssigned = Boolean(
      customerName && currentRooms.some(r => r.notes && r.notes.includes(customerName))
    );
    if (res.assignedRoom || isManuallyAssigned) {
      logs.push(`[건너뜀] ${displayName} 고객님은 이미 배정되었습니다 (${res.assignedRoom || '수기 배정'}).`);
      continue;
    }

    // 1. AI 선호도 분석 결과 (Vercel 엔진에서 받아온 값 복사)
    const prefs = {
      wantsHighFloor: false,
      wantsLowFloor: false,
      needsAccessible: false,
      isConnectingRequired: false,
      wantsQuiet: false,
      wantsNearElevator: false,
      otherKeywords: [],
      ...(res.preferences || {})
    };

    // DB에서 파싱해준 Flag 우선 적용
    if (res.reqHighFloor ?? res.req_high_floor) prefs.wantsHighFloor = true;
    if (res.reqQuiet ?? res.req_quiet) prefs.wantsQuiet = true;
    if (res.reqNearElevator ?? res.req_near_elevator) prefs.wantsNearElevator = true;

    // 비고(메모) 기반 자연어 추가 분석 (AI 엔진 오프라인 대비 또는 보완)
    const guestNotes = res.notes || '';
    const kwText = Array.isArray(prefs.otherKeywords) ? prefs.otherKeywords.join(' ') : '';
    const combinedText = `${guestNotes} ${kwText}`;

    if (/고층|높은\s*층|높은층/.test(combinedText)) prefs.wantsHighFloor = true;
    if (/저층|낮은\s*층|낮은층|1층|2층/.test(combinedText)) prefs.wantsLowFloor = true;
    if (/장애인|휠체어|거동/.test(combinedText)) prefs.needsAccessible = true;
    if (/조용|소음/.test(combinedText)) prefs.wantsQuiet = true;
    if (/엘리베이터|엘베|가까운/.test(combinedText)) prefs.wantsNearElevator = true;

    // 이동약자(장애인/휠체어) 안전 절대 우선: 고층 선호와 충돌 시 저층/엘리베이터 직결 객실로 강제
    if (prefs.needsAccessible) {
      prefs.wantsHighFloor = false;
      prefs.wantsLowFloor = true;
    }

    // 단체(그룹) 일괄 배정 로직: 같은 그룹은 가급적 같은 동에 배정
    const groupName = res.groupName || res.group_name;
    if (
      groupName &&
      !prefs.forcedBuilding &&
      (guestNotes.includes('같은동') || guestNotes.includes('같은 동') || guestNotes.includes('인접') || guestNotes.includes('모여'))
    ) {
      if (groupBuildingMap[groupName]) {
        prefs.forcedBuilding = groupBuildingMap[groupName];
        logs.push(`  └ 단체 자연어 분석: "같은동" 요청 반영 -> [${prefs.forcedBuilding}동] 강제 지정`);
      }
    }

    // 2. 타입에 맞는 빈 방 필터링
    const { effectiveRoomType, extractedFromNotes } = resolveRoomType(res);
    if (extractedFromNotes) {
      logs.push(`  └ 메모에서 객실 타입(${effectiveRoomType}) 자동 추출 반영`);
    }

    logs.push(`---`);
    logs.push(`[진행중] ${displayName} 고객님 (${effectiveRoomType || '타입 미지정'}) 분석 시작...`);
    logs.push(`  └ 통합 분석 결과: ${JSON.stringify(prefs)}`);

    if (!effectiveRoomType) {
      logs.push(`  ❌ [배정 실패] 객실 타입(평형) 정보가 없어 배정을 건너뜁니다.`);
      continue;
    }

    let candidateRooms = availableRooms.filter(r => {
      if (effectiveRoomType === '51P') {
        // ① 단독 51P 장애인 전용 객실 (size === '51P' && !isConnecting) 허용
        if (r.size === '51P' && !r.isConnecting) {
          return true;
        }
        // ② 커넥팅 51P (35P + 16P 페어): 중복 후보 방지를 위해 주객실(35P) 또는 강제 지정 호수를 기준으로 인접 객실 가용 여부 확인
        if (!r.isConnecting || !r.adjacent) return false;
        if (r.size !== '35P' && prefs.forcedRoom !== r.roomNumber) return false;
        const adjacentRoom = availableRooms.find(
          ar => ar.roomNumber === r.adjacent && ar.building === r.building
        );
        return adjacentRoom !== undefined;
      }
      return r.size === effectiveRoomType;
    });

    // 2-1. 관리자 강제 규칙(동, 호수) 필터링 (교착 상태 방지 Graceful Fallthrough 지원)
    let filteredCandidates = candidateRooms;
    if (prefs.forcedBuilding) {
      const bRooms = filteredCandidates.filter(
        r => r.building === prefs.forcedBuilding || (r.roomNumber && r.roomNumber.startsWith(prefs.forcedBuilding))
      );
      if (bRooms.length > 0) {
        filteredCandidates = bRooms;
        logs.push(`  └ 관리자 규칙: [${prefs.forcedBuilding}동]으로 필터링`);
      } else {
        logs.push(`  ⚠️ [규칙 완화] [${prefs.forcedBuilding}동] 잔여 객실 부족으로 전체 동에서 탐색합니다.`);
      }
    }

    if (prefs.forcedRoom) {
      const rRooms = filteredCandidates.filter(
        r => r.roomNumber === prefs.forcedRoom || (effectiveRoomType === '51P' && r.adjacent === prefs.forcedRoom)
      );
      if (rRooms.length > 0) {
        filteredCandidates = rRooms;
        logs.push(`  └ 관리자 규칙: [${prefs.forcedRoom}호]로 지정`);
      } else {
        logs.push(`  ⚠️ [규칙 완화] 지정된 [${prefs.forcedRoom}호]가 사용 불가하여 동일 조건 대체 호실로 자동 전환합니다.`);
      }
    }
    candidateRooms = filteredCandidates;

    if (candidateRooms.length === 0) {
      logs.push(`  ❌ [배정 실패] 조건에 맞는 ${effectiveRoomType} 빈 방이 없습니다.`);
      continue;
    }

    // 3. 다차원 특징 매칭 및 인벤토리 최적화 스코어링
    const viewReq = /경치|뷰|전망|레이크|골프장뷰/.test(combinedText);
    const lightReq = /채광|햇빛|밝은|남향/.test(combinedText);
    const wideReq = /넓은|큰방|큰\s*방/.test(combinedText);
    const wantsTwin = /트윈|싱글\s*2|침대\s*2|침대두개|각방|s\+s/i.test(combinedText);
    const wantsFamilyBed = /패밀리|가족|아기|유아|아이|3인|q\+s/i.test(combinedText);
    const wantsDouble = /더블|퀸|커플|부부|원베드/i.test(combinedText);
    const isVipGuest = Boolean(res.isVip ?? res.is_vip);

    candidateRooms.forEach(room => {
      let score = 0;

      // 51P 커넥팅의 경우 연결된 두 객실의 특징을 합산하여 평가
      let roomFeatures = [...(room.features || room.room_features || [])];
      if (effectiveRoomType === '51P' && room.isConnecting && room.adjacent) {
        const adj = availableRooms.find(ar => ar.building === room.building && ar.roomNumber === room.adjacent);
        if (adj) {
          roomFeatures = [...new Set([...roomFeatures, ...(adj.features || adj.room_features || [])])];
        }
      }

      // 3-1. 객실 특징(Features) 매칭
      if (prefs.wantsQuiet && roomFeatures.includes('조용함')) score += 15;
      if (viewReq && roomFeatures.includes('경치좋음')) score += 15;
      if (lightReq && roomFeatures.includes('채광좋음')) score += 12;
      if (prefs.wantsNearElevator && roomFeatures.includes('엘리베이터가까움')) score += 15;
      if (wideReq && roomFeatures.includes('넓은객실')) score += 12;

      // 3-2. 침대 타입(BedType: Q+S, S+S, Q) 정밀 매칭
      if (room.bedType) {
        if (wantsTwin) {
          if (room.bedType === 'S+S') score += 20;
          else if (room.bedType.includes('+')) score += 12;
        } else if (wantsFamilyBed && room.bedType === 'Q+S') {
          score += 15;
        } else if (wantsDouble && (room.bedType === 'Q' || room.bedType === 'Q+S')) {
          score += 12;
        }
      }

      // 3-3. 소음 주의(noiseWarning) 객실 감점 방어
      if (room.noiseWarning && String(room.noiseWarning).trim() !== '') {
        score -= prefs.wantsQuiet ? 50 : 15;
      }

      // 3-4. 16P / 35P 단품 배정 시 '온전한 51P 세트(Unbroken Set)' 보호 가산점 (Pair-Packing)
      // 인접 커넥팅 객실이 이미 팔렸거나 차단되어 짝이 깨진(Broken Pair) 객실을 먼저 채워 51P 세트를 보존함
      if ((effectiveRoomType === '16P' || effectiveRoomType === '35P') && room.isConnecting && room.adjacent) {
        const isPartnerAvailable = availableRooms.some(
          ar => ar.building === room.building && ar.roomNumber === room.adjacent
        );
        if (!isPartnerAvailable) {
          score += 25; // 이미 짝이 깨진 방 우선 배정
        }
      }

      // 3-5. VIP 고객 기본 로열층(3~4층) 우대 (저층/장애인 요청이 없을 때)
      const roomFloor = parseInt(String(room.roomNumber || '').charAt(0), 10);
      if (isVipGuest && !prefs.wantsLowFloor && !prefs.needsAccessible && roomFloor >= 3) {
        score += 8;
      }

      // 3-6. 단체 및 일행 클러스터링 (동일 동 +100점, 동일 층 +30점, 인접 호수 +20점)
      if (groupName && groupBuildingMap[groupName] === room.building) {
        score += 100;
        const assignedNums = groupAssignedRooms[groupName] || [];
        const currentNum = parseInt(room.roomNumber, 10);
        if (!isNaN(currentNum) && assignedNums.length > 0) {
          const sameFloor = assignedNums.some(n => Math.floor(n / 100) === Math.floor(currentNum / 100));
          const nearRoom = assignedNums.some(n => Math.abs(n - currentNum) <= 2);
          if (sameFloor) score += 30;
          if (nearRoom) score += 20;
        }
      }

      room.matchScore = score;
    });

    // 4. 선호도 및 보호 정책에 따른 최종 정렬/선택
    candidateRooms.sort((a, b) => {
      // 1순위: 장애인/이동약자 전용 객실(단독 51P 포함) 보호 및 최후순위 배정 정책
      const aHandicap = isHandicapRoom(a);
      const bHandicap = isHandicapRoom(b);
      if (prefs.needsAccessible) {
        // 장애인/휠체어 고객: 전용 객실을 최우선 배정
        if (aHandicap && !bHandicap) return -1;
        if (!aHandicap && bHandicap) return 1;
      } else {
        // 비장애인 일반 고객: 일반 객실(일반 51P 커넥팅 세트 등)을 먼저 배정하고, 장애인 전용 객실은 최후순위로 허용
        if (aHandicap && !bHandicap) return 1;
        if (!aHandicap && bHandicap) return -1;
      }

      // 2순위: 특징 및 클러스터링 매칭 점수
      if (b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }

      // 3순위: 층수 선호도
      if (prefs.wantsHighFloor) {
        return (b.roomNumber || '').localeCompare(a.roomNumber || '');
      } else if (prefs.wantsLowFloor) {
        return (a.roomNumber || '').localeCompare(b.roomNumber || '');
      }
      return 0;
    });

    const selectedRoom = candidateRooms[0];
    const selectedIsHandicap = isHandicapRoom(selectedRoom);

    // Build AI reason string
    let aiReason = '';
    if (prefs.forcedBuilding) {
      aiReason = `동 ${prefs.forcedBuilding} 강제 지정`;
    } else if (prefs.forcedRoom) {
      aiReason = `호 ${prefs.forcedRoom} 강제 지정`;
    } else if (prefs.needsAccessible && selectedIsHandicap) {
      aiReason = `장애인/이동약자 전용 객실 맞춤 배정`;
    } else if (groupName) {
      aiReason = `그룹 ${groupName} 클러스터 배정`;
    } else if (selectedRoom.matchScore > 0) {
      const roomFeatures = selectedRoom.room_features || selectedRoom.features || [];
      const featureList = roomFeatures.join(', ') || selectedRoom.bedType;
      aiReason = `특징/인벤토리 최적화 (${featureList})`;
    } else if (selectedIsHandicap && !prefs.needsAccessible) {
      aiReason = `일반 잔여 소진에 따른 최후순위 배정`;
    } else {
      aiReason = '일반 배정';
    }

    if (selectedRoom.matchScore > 0) {
      logs.push(`  └ ✨ AI 최적 매칭(${selectedRoom.matchScore}점): ${aiReason} - ${selectedRoom.roomNumber}호`);
    } else {
      logs.push(`  └ ✨ AI 배정: ${aiReason} - ${selectedRoom.roomNumber}호`);
    }

    // Detect special tags
    const tags = [];
    const noteLower = (res.notes || '').toLowerCase();
    if (noteLower.includes('vip') || isVipGuest) tags.push('VIP');
    if (noteLower.includes('complaint') || noteLower.includes('주의')) tags.push('주의');
    if (noteLower.match(/(\d{1,2}:\d{2})|early|얼리|14시|13시|12시/)) tags.push('청소긴급');

    if (groupName) {
      if (!groupBuildingMap[groupName]) {
        groupBuildingMap[groupName] = selectedRoom.building;
      }
      if (!groupAssignedRooms[groupName]) {
        groupAssignedRooms[groupName] = [];
      }
      const rNum = parseInt(selectedRoom.roomNumber, 10);
      if (!isNaN(rNum)) groupAssignedRooms[groupName].push(rNum);
    }

    // 5. 배정 확정 및 51평(단독 vs 락오프 커넥팅) 분기 처리
    if (effectiveRoomType === '51P') {
      // ① 단독 51P 장애인 전용 객실(isConnecting === false)이 선택된 경우
      if (!selectedRoom.isConnecting) {
        assignments.push({
          reservationId: res.reservationId || res.id,
          customerName: customerName || displayName,
          stayLength: res.stayLength || 1,
          checkInDate: res.checkInDate || new Date().toISOString(),
          assignedRooms: [selectedRoom.id],
          type: '51P',
          aiReason: aiReason,
          tags: tags,
          group_name: groupName
        });
        logs.push(`  ✅ [배정 성공] 51평형(단독/장애인전용): ${selectedRoom.roomNumber}호 배정 완료 – ${aiReason}`);
        availableRooms.splice(availableRooms.findIndex(r => r.id === selectedRoom.id), 1);
      } else {
        // ② 커넥팅 51P (35P + 16P 페어) 통합 배정
        const adjacentRoom = availableRooms.find(
          r => r.roomNumber === selectedRoom.adjacent && r.building === selectedRoom.building
        );
        if (!adjacentRoom) {
          logs.push(`  ❌ [배정 실패] 51평형 인접 객실을 찾을 수 없습니다.`);
          continue;
        }
        assignments.push({
          reservationId: res.reservationId || res.id,
          customerName: customerName || displayName,
          stayLength: res.stayLength || 1,
          checkInDate: res.checkInDate || new Date().toISOString(),
          assignedRooms: [selectedRoom.id, adjacentRoom.id],
          type: '51P',
          aiReason: aiReason,
          tags: tags,
          group_name: groupName
        });
        logs.push(`  ✅ [배정 성공] 51평형(락오프): ${selectedRoom.roomNumber}호 + ${adjacentRoom.roomNumber}호 통합 배정 완료 – ${aiReason}`);

        // 인벤토리에서 두 객실 원자적 동시 제외
        availableRooms.splice(availableRooms.findIndex(r => r.id === selectedRoom.id), 1);
        availableRooms.splice(availableRooms.findIndex(r => r.id === adjacentRoom.id), 1);
      }
    } else {
      assignments.push({
        reservationId: res.reservationId || res.id,
        customerName: customerName || displayName,
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
