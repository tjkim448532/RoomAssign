import { db } from '../firebase';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';

// Vercel 운영 서버 도메인 연결
const VERCEL_API_URL = "https://belleforet-data.vercel.app/api/v3/roomassign/reservations";

export async function fetchTodayReservations(targetDate, activeRules = []) {
  console.log("Firebase에서 가상 예약 데이터를 읽은 뒤, Vercel AI 엔진(Gemini)에 분석을 요청합니다...");
  
  try {
    // 1. 파이어베이스에서 예약 데이터 조회 (MariaDB 우회)
    const snapshot = await getDocs(collection(db, 'reservations'));
    let reservations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // 아직 방 배정이 안 된 건 중, 선택한 타겟 날짜(targetDate)와 일치하는 예약만 필터링
    reservations = reservations.filter(r => 
      !r.assignedRoom && 
      r.checkInDate && 
      r.checkInDate.startsWith(targetDate)
    );

    if (reservations.length === 0) {
      return [];
    }

    // --- AI 최적화 캐싱 및 필터링 로직 ---
    const cachedReservations = [];
    const needsAiReservations = [];

    reservations.forEach(r => {
      // 1. 메모나 그룹명이 아예 없는 경우: AI 분석 불필요 (비용 0원)
      if (!r.notes && !r.group_name && !r.groupName) {
        cachedReservations.push({ ...r, ai_preferences: {} });
        return;
      }
      
      // 2. 이미 캐싱된 분석 결과가 있고, 당시 분석했던 메모 원본이 현재 메모와 동일한 경우
      if (r.ai_preferences && r.ai_cached_notes === r.notes) {
        cachedReservations.push(r);
        return;
      }

      // 3. 신규 예약이거나 메모가 수정된 경우 (AI 분석 필요)
      needsAiReservations.push(r);
    });

    // 분석이 필요한 예약이 하나도 없다면 캐싱된 결과만 즉시 리턴
    if (needsAiReservations.length === 0) {
      console.log(`✨ AI 호출 생략: 총 ${cachedReservations.length}건 캐시 사용`);
      return cachedReservations;
    }

    console.log(`🤖 Vercel AI 엔진 전송: 신규/수정 ${needsAiReservations.length}건 (캐시 ${cachedReservations.length}건)`);

    // 2. Vercel AI로 분석이 필요한 예약 목록 + 관리자 특수 규칙 전달
    const response = await fetch(VERCEL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_API_SECRET_KEY || "BELLE_AUTO_SECURE_99381"}`
      },
      body: JSON.stringify({
        reservations: needsAiReservations,
        rules: activeRules
      })
    });

    const contentType = response.headers.get('content-type');
    if (!response.ok || !contentType || !contentType.includes('application/json')) {
      throw new Error("Vercel AI API 통신 오류 또는 잘못된 응답 형식입니다.");
    }
    
    const json = await response.json();
    
    if (json.success && json.data) {
      const newlyAnalyzed = json.data;

      // 3. 새로 분석된 데이터를 Firebase에 캐싱 저장
      try {
        const batch = writeBatch(db);
        newlyAnalyzed.forEach(r => {
          if (r.ai_preferences) {
             const resRef = doc(db, 'reservations', String(r.reservationId || r.id));
             batch.update(resRef, {
               ai_preferences: r.ai_preferences,
               ai_cached_notes: r.notes || ''
             });
          }
        });
        await batch.commit();
        console.log("💾 새로운 AI 분석 결과를 Firebase에 성공적으로 캐싱했습니다.");
      } catch (err) {
        console.warn("Firebase 캐싱 저장 실패:", err);
      }

      // 캐싱 데이터와 신규 분석 데이터를 합쳐서 리턴
      return [...cachedReservations, ...newlyAnalyzed];
    } else {
      throw new Error(json.message || "AI 엔진 응답 처리 실패");
    }
  } catch (error) {
    console.error("Vercel AI API 연동 실패:", error);
    // API 연결 실패 시, 가짜 데이터를 리턴하는 대신 에러를 발생시킵니다. (마리아DB 실제 데이터만 사용)
    throw new Error("AI 배정 엔진에 연결할 수 없습니다. " + error.message);
  }
}
