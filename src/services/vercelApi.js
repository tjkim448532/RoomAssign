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

    const contentType = response.headers.get('content-type');
    if (!response.ok || !contentType || !contentType.includes('application/json')) {
      throw new Error("Vercel AI API 통신 오류 또는 잘못된 응답 형식입니다.");
    }
    
    const json = await response.json();
    
    if (json.success && json.data) {
      return json.data;
    } else {
      throw new Error(json.message || "AI 엔진 응답 처리 실패");
    }
  } catch (error) {
    console.error("Vercel AI API 연동 실패:", error);
    // API 연결 실패 시, 가짜 데이터를 리턴하는 대신 에러를 발생시킵니다. (마리아DB 실제 데이터만 사용)
    throw new Error("AI 배정 엔진에 연결할 수 없습니다. " + error.message);
  }
}
