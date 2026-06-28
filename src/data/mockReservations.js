export const generateMockReservations = () => {
  const types = ['16P', '35P', '51P'];
  const baseNotes = [
    "",
    "조용한 방 원합니다.",
    "휠체어 사용합니다. 접근성 좋은 방 부탁드려요.",
    "엘리베이터 근처 방으로 배정 부탁드립니다.",
    "어린 아기가 있어서 층간소음 없는 1층 부탁드립니다.",
    "창가쪽 방 뷰 좋은데로 부탁합니다.",
    "얼리 체크인 가능한가요?",
    "레이트 체크아웃 원합니다."
  ];

  const firstNames = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권'];
  const lastNames = ['민준', '서준', '도윤', '예준', '시우', '하준', '주원', '지호', '지훈', '준우', '서연', '서윤', '지우', '서현', '하은', '민서', '지민', '희진', '철수', '영희', '지영'];

  const mocks = [];
  for (let i = 1; i <= 100; i++) {
    const fn = firstNames[Math.floor(Math.random() * firstNames.length)];
    const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
    const type = types[Math.floor(Math.random() * types.length)];
    
    // 의도적으로 특정 시나리오 부여
    let note = "";
    let forcedType = type;

    if (i <= 10) {
      note = "하나은행 워크샵 참석자입니다.";
      // 하나은행 규칙 테스트를 위해 평형을 섞어둠
    } else if (i > 10 && i <= 15) {
      note = "휠체어 사용합니다. 엘리베이터 가깝고 문턱 없는 방으로.";
    } else if (i > 15 && i <= 25) {
      note = "신혼 부부입니다. 무조건 고층에 조용하고 뷰 좋은 방 부탁드려요.";
    } else if (i > 25 && i <= 30) {
      note = "어린이 유치원 단체입니다. 애들이 뛰니까 가급적 1층 저층으로 주세요.";
    } else if (i > 30 && i <= 35) {
      note = "장애인 할아버지 모시고 갑니다. 무조건 1층 엘리베이터 바로 앞 방.";
    } else if (i > 35 && i <= 40) {
      note = "3대가 함께하는 대가족 여행입니다. 방 2개가 내부에서 연결되는 커넥팅룸 원합니다.";
      forcedType = '51P'; // 51평형 예약으로 강제
    } else if (i > 40 && i <= 60) {
      note = baseNotes[Math.floor(Math.random() * baseNotes.length)];
    } else {
      note = ""; // 특별한 메모 없음
    }

    // MariaDB 확장 필드 가상 생성
    const stayLength = Math.floor(Math.random() * 3) + 1; // 1박 ~ 3박
    const adults = Math.floor(Math.random() * 4) + 1;
    const children = Math.floor(Math.random() * 3);
    
    // 날짜 계산 (오늘 기준)
    const today = new Date();
    const checkInDate = today.toISOString().split('T')[0];
    const checkOutDate = new Date(today.getTime() + stayLength * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    mocks.push({
      reservationId: `RES-MOCK-${1000 + i}`,
      customerName: `${fn}${ln}`,
      roomType: forcedType,
      notes: note,
      assignedRoom: null,
      // MariaDB fields
      checkInDate,
      checkOutDate,
      stayLength,
      adults,
      children,
      status: 'confirmed'
    });
  }
  return mocks;
};

// 가상 객실 상태 생성기 (실제 마리아DB 동기화 시뮬레이션)
export const generateMockRoomsState = (rooms) => {
  return rooms.map(room => {
    // 이미 수동으로 배정된 방이나 차단된 방은 그대로 둠
    if (room.status === 'assigned' || room.status === 'blocked') return room;

    const rand = Math.random();
    
    // 30% 확률로 연박중 (Occupied)
    if (rand < 0.30) {
      return { 
        ...room, 
        status: 'occupied', 
        notes: '[연박중] 배정불가' 
      };
    } 
    // 20% 확률로 당일퇴실 (Checkout/Cleaning)
    else if (rand >= 0.30 && rand < 0.50) {
      return { 
        ...room, 
        status: 'checkout', 
        notes: '[당일퇴실] 청소후 배정가능' 
      };
    } 
    // 5% 확률로 고장/점검 (OOO)
    else if (rand >= 0.50 && rand < 0.55) {
      return { 
        ...room, 
        status: 'ooo', 
        notes: '[점검중] 누수 공사' 
      };
    }
    
    // 나머지 45%는 완전 빈 방 (Available)
    return {
      ...room,
      status: 'available',
      notes: ''
    };
  });
};
