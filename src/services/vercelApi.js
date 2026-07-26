import { db } from "../firebase";
import { collection, getDocs, writeBatch, doc, query, where } from "firebase/firestore";

const VERCEL_API_URL = "https://belleforet-data.vercel.app/api/v3/roomassign/reservations";

// Safe Firestore batch commit helper
const commitInBatches = async (dbInstance, operations) => {
  const CHUNK_SIZE = 400;
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const chunk = operations.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(dbInstance);
    chunk.forEach(op => op(batch));
    await batch.commit();
  }
};

export async function fetchTodayReservations(targetDate, activeRules = []) {
  console.log("Firebase에서 가상 예약 데이터를 읽은 뒤, Vercel AI 엔진에 분석을 요청합니다...");
  
  try {
    const q = query(
      collection(db, "reservations"),
      where("checkInDate", ">=", targetDate),
      where("checkInDate", "<=", targetDate + "\uf8ff")
    );
    const snapshot = await getDocs(q);
    let reservations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    reservations = reservations.filter(r => !r.assignedRoom);

    if (reservations.length === 0) {
      return [];
    }

    const cachedReservations = [];
    const needsAiReservations = [];

    reservations.forEach(r => {
      const groupName = r.groupName || r.group_name;
      if (!r.notes && !groupName) {
        cachedReservations.push({ ...r, groupName, preferences: {} });
        return;
      }
      
      const currentNotes = r.notes || "";
      const cachedPref = r.aiPreferences || r.ai_preferences;
      const cachedNotes = r.aiCachedNotes || r.ai_cached_notes || "";
      if (cachedPref && cachedNotes === currentNotes) {
        cachedReservations.push({ ...r, groupName, preferences: cachedPref });
        return;
      }

      needsAiReservations.push({
        ...r,
        groupName: groupName,
        group_name: groupName
      });
    });

    if (needsAiReservations.length === 0) {
      console.log("✨ AI 호출 생략: 총 " + cachedReservations.length + "건 캐시 사용");
      return cachedReservations;
    }

    console.log("🤖 Vercel AI 엔진 전송: 총 " + needsAiReservations.length + "건 (캐시: " + cachedReservations.length + "건)...");

    // 25건씩 청크 생성
    const CHUNK_SIZE = 25;
    const chunks = [];
    for (let i = 0; i < needsAiReservations.length; i += CHUNK_SIZE) {
      chunks.push({
        startIndex: i + 1,
        endIndex: Math.min(i + CHUNK_SIZE, needsAiReservations.length),
        data: needsAiReservations.slice(i, i + CHUNK_SIZE)
      });
    }

    const newlyAnalyzed = [];

    // 동시 3개 청크씩 병렬 실행 (속도 3배 향상 및 순차 지연 원천 방지)
    const CONCURRENCY = 3;
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batchChunks = chunks.slice(i, i + CONCURRENCY);
      console.log("🤖 Vercel AI 병렬 전송 실행 중 (" + (i + 1) + "~" + Math.min(i + CONCURRENCY, chunks.length) + " / 총 " + chunks.length + "개 그룹)...");
      
      const results = await Promise.all(
        batchChunks.map(async (c) => {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15초 타임아웃 방어

            const response = await fetch(VERCEL_API_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + (import.meta.env.VITE_API_SECRET_KEY || "BELLE_AUTO_SECURE_99381")
              },
              body: JSON.stringify({
                reservations: c.data,
                rules: activeRules
              }),
              signal: controller.signal
            });
            clearTimeout(timeoutId);

            const contentType = response.headers.get("content-type");
            if (!response.ok || !contentType || !contentType.includes("application/json")) {
              console.warn("청크 [" + c.startIndex + "~" + c.endIndex + "] API 오류 (" + response.status + "), 기본값 처리");
              return c.data.map(r => ({ ...r, preferences: {} }));
            }

            const json = await response.json();
            if (json.success && Array.isArray(json.data)) {
              return json.data;
            } else {
              console.warn("청크 [" + c.startIndex + "~" + c.endIndex + "] 데이터 파싱 실패, 기본값 처리");
              return c.data.map(r => ({ ...r, preferences: {} }));
            }
          } catch (err) {
            console.warn("청크 [" + c.startIndex + "~" + c.endIndex + "] 통신 예외 발생 (" + err.message + "), 기본값 처리");
            return c.data.map(r => ({ ...r, preferences: {} }));
          }
        })
      );

      results.forEach(res => newlyAnalyzed.push(...res));
    }

    // 3. 새로 분석된 데이터를 Firebase에 400건 단위 안전 캐싱 저장
    if (newlyAnalyzed.length > 0) {
      try {
        const ops = [];
        newlyAnalyzed.forEach(r => {
          if (r.preferences) {
             const resRef = doc(db, "reservations", String(r.reservationId || r.id));
             ops.push(b => b.update(resRef, {
               aiPreferences: r.preferences,
               aiCachedNotes: r.notes || ""
             }));
          }
        });
        await commitInBatches(db, ops);
        console.log("💾 새로운 AI 분석 결과를 Firebase에 성공적으로 캐싱했습니다.");
      } catch (err) {
        console.warn("Firebase 캐싱 저장 실패:", err);
      }
    }

    return [...cachedReservations, ...newlyAnalyzed];
  } catch (error) {
    console.error("Vercel AI API 연동 실패:", error);
    throw new Error("AI 배정 엔진에 연결할 수 없습니다. " + error.message);
  }
}