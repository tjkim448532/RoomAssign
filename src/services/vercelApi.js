/**
 * Vercel API 통신 모듈 (MariaDB Read-Only Proxy)
 * 실제 구현 시 VERCEL_API_URL 값을 환경 변수 등으로 교체해야 합니다.
 */

const VERCEL_API_URL = "https://your-vercel-engine.app/api";

export async function fetchTodayReservations() {
  console.log("Vercel 엔진을 통해 AWS MariaDB에서 오늘자 예약을 읽어옵니다...");
  
  // TODO: 실제 구현 시 주석 해제 및 API 연동
  /*
  const response = await fetch(`${VERCEL_API_URL}/reservations/today`);
  if (!response.ok) throw new Error("Vercel API 통신 오류");
  return await response.json();
  */

  // 개발 및 테스트용 Mock 데이터 반환 (실제 Vercel API가 던져줄 요약 테이블 형태)
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        {
          reservationId: "RES-1001",
          customerName: "김철수",
          roomType: "35P", // 예약한 객실 타입
          notes: "조용한 고층 방으로 부탁드립니다. 뷰가 좋으면 좋겠어요.", // MariaDB 비고란
          assignedRoom: null
        },
        {
          reservationId: "RES-1002",
          customerName: "이영희",
          roomType: "16P",
          notes: "휠체어 사용자가 있습니다. 무조건 1층이나 엘리베이터 바로 앞 방으로 주세요.",
          assignedRoom: null
        },
        {
          reservationId: "RES-1003",
          customerName: "박가족",
          roomType: "51P", // 51평형 (16P+35P 커넥팅)
          notes: "대가족 이동입니다. 두 방이 무조건 붙어있는 51평형 락오프 객실 필수입니다.",
          assignedRoom: null
        }
      ]);
    }, 1000); // 네트워크 딜레이 1초 시뮬레이션
  });
}
