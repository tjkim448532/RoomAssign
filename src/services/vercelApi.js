import { db } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';

// Vercel 운영 서버 도메인 연결
const VERCEL_API_URL = "https://belleforet-data.vercel.app/api/v3/roomassign/reservations";

export async function fetchTodayReservations(activeRules = []) {
  console.log("Firebase에서 가상 예약 데이터를 읽은 뒤, Vercel AI 엔진(Gemini)에 분석을 요청합니다...");
  
  try {
    // 1. 파이어베이스에서 예약 데이터 조회 (MariaDB 우회)
    const snapshot = await getDocs(collection(db, 'reservations'));
    let reservations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // 아직 방 배정이 안 된 건만 필터링
    reservations = reservations.filter(r => !r.assignedRoom);

    if (reservations.length === 0) {
      return [];
    }

    // 2. Vercel AI로 예약 목록 + 관리자 특수 규칙 전달
    const response = await fetch(VERCEL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reservations,
        rules: activeRules
      })
    });

    if (!response.ok) throw new Error("Vercel API 통신 오류");
    const json = await response.json();
    
    if (json.success && json.data) {
      return json.data;
    }
  } catch (error) {
    console.warn("Vercel API 연동 실패, 로컬 Mock 데이터를 대신 반환합니다.", error);
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
