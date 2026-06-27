/**
 * 지능형 객실 배정 알고리즘
 * @param {Array} reservations - Vercel에서 받아온 예약 리스트 (AI 선호도 분석 포함)
 * @param {Array} currentRooms - 현재 객실 인벤토리 상태
 * @returns {Object} { assignments: [], logs: [] }
 */
export async function runAutoAssignment(reservations, currentRooms) {
  const assignments = [];
  const logs = [];
  const availableRooms = JSON.parse(JSON.stringify(currentRooms)).filter(r => r.status === 'available');

  logs.push(`자동 배정 엔진 시작: 총 ${reservations.length}건의 예약을 처리합니다.`);

  for (const res of reservations) {
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
    const effectiveRoomType = prefs.forcedSize || res.roomType;
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

    // 3. 선호도에 따른 정렬/선택 (단순 로직)
    if (prefs.wantsHighFloor) {
      candidateRooms = candidateRooms.sort((a, b) => b.roomNumber.localeCompare(a.roomNumber));
    } else if (prefs.wantsLowFloor) {
      candidateRooms = candidateRooms.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
    }

    if (prefs.needsAccessible) {
      const disabledRooms = candidateRooms.filter(r => r.isDisabled);
      if (disabledRooms.length > 0) candidateRooms = disabledRooms;
    }

    const selectedRoom = candidateRooms[0];

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
