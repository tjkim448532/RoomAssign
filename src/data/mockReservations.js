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

    mocks.push({
      reservationId: `RES-MOCK-${1000 + i}`,
      customerName: `${fn}${ln}`,
      roomType: forcedType,
      notes: note,
      assignedRoom: null
    });
  }
  return mocks;
};
