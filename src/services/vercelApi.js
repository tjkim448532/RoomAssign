/**
 * Vercel API 통신 모듈 (MariaDB Read-Only Proxy & Gemini AI Analysis)
 */

// 실제 Vercel 배포 시 해당 도메인으로 변경하세요 (예: https://belleforet-data.vercel.app/api/v3/roomassign/reservations)
const VERCEL_API_URL = "http://localhost:3000/api/v3/roomassign/reservations";

export async function fetchTodayReservations() {
  console.log("Vercel 엔진을 통해 AWS MariaDB에서 예약 데이터와 Gemini AI 선호도 분석 결과를 읽어옵니다...");
  
  try {
    const response = await fetch(VERCEL_API_URL);
    if (!response.ok) throw new Error("Vercel API 통신 오류");
    const json = await response.json();
    
    if (json.success && json.data) {
      return json.data; // Vercel API에서 AI 분석 결과(preferences)까지 포함하여 반환됨
    }
  } catch (error) {
    console.warn("Vercel API 연동 실패, Mock 데이터를 대신 반환합니다.", error);
  }

  // Vercel 엔진 미구동 시 개발용 Mock 데이터 (API 응답 규격과 동일)
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        {
          reservationId: "RES-1001",
          customerName: "김철수",
          roomType: "35P",
          notes: "조용한 고층 방으로 부탁드립니다. 뷰가 좋으면 좋겠어요.",
          preferences: { wantsHighFloor: true, wantsLowFloor: false, needsAccessible: false, isConnectingRequired: false, otherKeywords: ["조용한", "뷰"] }
        },
        {
          reservationId: "RES-1002",
          customerName: "이영희",
          roomType: "16P",
          notes: "휠체어 사용자가 있습니다. 무조건 1층이나 엘리베이터 바로 앞 방으로 주세요.",
          preferences: { wantsHighFloor: false, wantsLowFloor: true, needsAccessible: true, isConnectingRequired: false, otherKeywords: ["엘리베이터 앞"] }
        },
        {
          reservationId: "RES-1003",
          customerName: "박가족",
          roomType: "51P",
          notes: "대가족 이동입니다. 두 방이 무조건 붙어있는 51평형 락오프 객실 필수입니다.",
          preferences: { wantsHighFloor: false, wantsLowFloor: false, needsAccessible: false, isConnectingRequired: true, otherKeywords: ["대가족"] }
        }
      ]);
    }, 1000);
  });
}
