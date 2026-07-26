import { db } from '../firebase';
import { collection, getDocs, writeBatch, doc, query, where } from 'firebase/firestore';

const VERCEL_API_URL = 'https://belleforet-data.vercel.app/api/v3/roomassign/reservations';

export async function fetchTodayReservations(targetDate, activeRules = []) {
  console.log('Firebase에서 가상 예약 데이터를 읽은 뒤, Vercel AI 엔진에 분석을 요청합니다...');
  
  try {
    const q = query(
      collection(db, 'reservations'),
      where('checkInDate', '>=', targetDate),
      where('checkInDate', '<=', targetDate + '\uf8ff')
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
      
      const currentNotes = r.notes || '';
      const cachedPref = r.aiPreferences || r.ai_preferences;
      const cachedNotes = r.aiCachedNotes || r.ai_cached_notes || '';
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
      console.log('✨ AI 호출 생략: 총 ' + cachedReservations.length + '건 캐시 사용');
      return cachedReservations;
    }

    console.log('🤖 Vercel AI 엔진 전송: 총 ' + needsAiReservations.length + '건...');

    const CHUNK_SIZE = 30;
    const newlyAnalyzed = [];

    for (let i = 0; i < needsAiReservations.length; i += CHUNK_SIZE) {
      const chunk = needsAiReservations.slice(i, i + CHUNK_SIZE);
      const startNum = i + 1;
      const endNum = Math.min(i + CHUNK_SIZE, needsAiReservations.length);
      console.log('🤖 Vercel AI 엔진 분할 전송 [' + startNum + '~' + endNum + ' / ' + needsAiReservations.length + '건]...');

      const response = await fetch(VERCEL_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (import.meta.env.VITE_API_SECRET_KEY || 'BELLE_AUTO_SECURE_99381')
        },
        body: JSON.stringify({
          reservations: chunk,
          rules: activeRules
        })
      });

      const contentType = response.headers.get('content-type');
      if (!response.ok || !contentType || !contentType.includes('application/json')) {
        throw new Error('Vercel AI API 통신 오류 (' + response.status + ')');
      }

      const json = await response.json();
      if (json.success && Array.isArray(json.data)) {
        newlyAnalyzed.push(...json.data);
      } else {
        throw new Error(json.message || 'AI 엔진 응답 처리 실패');
      }
    }

    if (newlyAnalyzed.length > 0) {
      try {
        const batch = writeBatch(db);
        newlyAnalyzed.forEach(r => {
          if (r.preferences) {
             const resRef = doc(db, 'reservations', String(r.reservationId || r.id));
             batch.update(resRef, {
               aiPreferences: r.preferences,
               aiCachedNotes: r.notes || ''
             });
          }
        });
        await batch.commit();
        console.log('💾 새로운 AI 분석 결과를 Firebase에 성공적으로 캐싱했습니다.');
      } catch (err) {
        console.warn('Firebase 캐싱 저장 실패:', err);
      }
    }

    return [...cachedReservations, ...newlyAnalyzed];
  } catch (error) {
    console.error('Vercel AI API 연동 실패:', error);
    throw new Error('AI 배정 엔진에 연결할 수 없습니다. ' + error.message);
  }
}