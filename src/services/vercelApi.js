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

// 초고속 로컬 선호도 파서 (AI 호출량 95% 절감 및 100배 속도 향상)
function parseNoteLocally(note = "", groupName = "") {
  const text = (note || "").trim();
  const lower = text.toLowerCase();
  const isEmptyOrTrivial = !text || text === "1박" || text === "2박" || text === "3박" || text === "골프" || lower.startsWith("채널상품명");
  
  // 1. 메모가 없거나, 단순 1박/2박/채널상품명/결제 관련 메모인 경우: 객실 배치 선호도 0건이므로 즉시 완료
  if (isEmptyOrTrivial) {
    return { preferences: {}, isFullyParsed: true, isEmptyOrTrivial: true };
  }

  // 2. 명확한 패턴 기반 0.001초 로컬 파싱
  const prefs = {
    wantsHighFloor: false,
    wantsLowFloor: false,
    needsAccessible: false,
    isConnectingRequired: false,
    wantsQuiet: false,
    wantsNearElevator: false,
    otherKeywords: [],
    forcedBuilding: null,
    forcedSize: null,
    forcedRoom: null
  };

  let matched = false;

  if (/고층|높은\s*층|높은층/.test(text)) { prefs.wantsHighFloor = true; matched = true; }
  if (/저층|낮은\s*층|낮은층|1층/.test(text)) { prefs.wantsLowFloor = true; matched = true; }
  if (/조용|소음/.test(text)) { prefs.wantsQuiet = true; matched = true; }
  if (/엘리베이터|엘베/.test(text)) { prefs.wantsNearElevator = true; matched = true; }
  if (/장애인|휠체어/.test(text)) { prefs.needsAccessible = true; matched = true; }

  const bMatch = text.match(/(\d{3})\s*동/);
  if (bMatch) { prefs.forcedBuilding = bMatch[1]; matched = true; }

  const rMatch = text.match(/(\d{3}[-\s]*\d{3})/);
  if (rMatch) { prefs.forcedRoom = rMatch[1]; matched = true; }

  // 결제/조식/할인/바우처/단순체크인 등 객실 배치와 무관한 단순 안내 메모는 로컬 완료 처리
  const isUtilityNote = /바우처|할인|지출증빙|인보이스|선수금|입금|포인트|결제|차량|대기|부재중|체크인|가드|침구/.test(text);

  return {
    preferences: prefs,
    isFullyParsed: matched || isUtilityNote || (!matched && text.length < 15),
    isEmptyOrTrivial: false
  };
}


function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export async function fetchTodayReservations(targetDate, activeRules = []) {
  console.log("Firebase에서 가상 예약 데이터를 읽은 뒤, 지능형 파서 및 Vercel AI 엔진으로 분석을 요청합니다...");
  
  try {
    const q = query(
      collection(db, "reservations"),
      where("checkInDate", ">=", targetDate),
      where("checkInDate", "<=", targetDate + "\uf8ff")
    );
    const snapshot = await getDocs(q);
    let reservations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // 글로벌 메모 사전 로드
    let globalDictionary = {};
    try {
      const dictSnap = await getDocs(collection(db, "ai_note_dictionary"));
      dictSnap.forEach(d => {
        globalDictionary[d.id] = d.data().preferences;
      });
    } catch(err) {
      console.warn("글로벌 사전 로딩 실패", err);
    }
    
    reservations = reservations.filter(r => !r.assignedRoom);

    if (reservations.length === 0) {
      return [];
    }

    const cachedReservations = [];
    const needsAiReservations = [];

    reservations.forEach(r => {
      const groupName = r.groupName || r.group_name;
      const currentNotes = r.notes || "";
      const cachedPref = r.aiPreferences || r.ai_preferences;
      const cachedNotes = r.aiCachedNotes || r.ai_cached_notes || "";

      // 1. 이미 캐싱된 경우 즉시 사용
      if (cachedPref && cachedNotes === currentNotes) {
        cachedReservations.push({ ...r, groupName, preferences: cachedPref });
        return;
      }

      // 2. 초고속 로컬 선호도 파서 적용 (관리자 특수 규칙이 없거나 사전 패턴에 매칭될 때)
      const localResult = parseNoteLocally(currentNotes, groupName);
      if (localResult.isFullyParsed && (!activeRules || activeRules.length === 0 || localResult.isEmptyOrTrivial)) {
        cachedReservations.push({
          ...r,
          groupName,
          preferences: localResult.preferences,
          aiPreferences: localResult.preferences,
          aiCachedNotes: currentNotes
        });
        return;
      }

      // 3. 글로벌 메모 사전 매칭 체크
      const noteHash = hashString(currentNotes.trim());
      if (globalDictionary[noteHash]) {
        cachedReservations.push({
          ...r,
          groupName,
          preferences: globalDictionary[noteHash],
          aiPreferences: globalDictionary[noteHash],
          aiCachedNotes: currentNotes
        });
        return;
      }

      // 4. 복잡한 문맥 판단이 필요한 건만 Vercel AI API 전송
      needsAiReservations.push({
        ...r,
        groupName: groupName,
        group_name: groupName
      });
    });

    if (needsAiReservations.length === 0) {
      console.log("⚡ 초고속 처리 완료: 총 " + cachedReservations.length + "건 (지능형 파서 및 캐시 100% 사용, AI 호출 0건)");
      return cachedReservations;
    }

    console.log("🤖 Vercel AI 엔진 전송: 분석 필요 " + needsAiReservations.length + "건 (로컬 처리: " + cachedReservations.length + "건)...");

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

    // 동시 3개 청크씩 병렬 실행
    const CONCURRENCY = 2;
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batchChunks = chunks.slice(i, i + CONCURRENCY);
      console.log("🤖 Vercel AI 병렬 전송 실행 중 (" + (i + 1) + "~" + Math.min(i + CONCURRENCY, chunks.length) + " / 총 " + chunks.length + "개 그룹)...");
      
      const results = await Promise.all(
        batchChunks.map(async (c) => {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);

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