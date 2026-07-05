import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, doc, writeBatch, onSnapshot, getDocs, query, where, updateDoc, addDoc, serverTimestamp, orderBy, limit } from 'firebase/firestore';
import roomsData from '../data/roomsData.json';

import { fetchTodayReservations } from '../services/vercelApi';
import { runAutoAssignment } from '../utils/autoAssigner';
import * as XLSX from 'xlsx';
import CustomRulesModal from './CustomRulesModal';

const playMagicSound = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    // Magical sparkle notes (C Lydian arp)
    const notes = [1046.50, 1318.51, 1479.98, 1567.98, 2093.00, 2637.02, 3135.96];
    
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.value = freq;
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      const startTime = ctx.currentTime + (i * 0.08);
      const duration = 0.8;
      
      osc.start(startTime);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.08, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.stop(startTime + duration);
    });
  } catch (err) {
    console.error('Audio play failed', err);
  }
};
function RoomInventory({ isAdmin, user }) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All'); // default to All view
  const [isInitializing, setIsInitializing] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [highlightGroup, setHighlightGroup] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [logs, setLogs] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const groupOptions = Array.from(new Set(rooms.map(r => r.group_name || r.groupName).filter(Boolean)));

  const [notesInput, setNotesInput] = useState('');
  const [featuresInput, setFeaturesInput] = useState([]);

  const [hasAutoAssigned, setHasAutoAssigned] = useState(false);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [activeRules, setActiveRules] = useState([]);
  const [isSettingDB, setIsSettingDB] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [targetDate, setTargetDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedForGroup, setSelectedForGroup] = useState([]);
  
  // Play magic sound when preview modal opens
  useEffect(() => {
    if (previewData) {
      playMagicSound();
    }
  }, [previewData]);

  // 자동 배정 ON/OFF 상태 (기본값: true, localStorage에 저장)
  const [isAutoAssignEnabled, setIsAutoAssignEnabled] = useState(() => {
    const saved = localStorage.getItem('isAutoAssignEnabled');
    return saved !== null ? JSON.parse(saved) : true;
  });

  const toggleAutoAssign = () => {
    const newState = !isAutoAssignEnabled;
    setIsAutoAssignEnabled(newState);
    localStorage.setItem('isAutoAssignEnabled', JSON.stringify(newState));
  };

  const logAction = async (actionText) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'logs'), {
        text: `${user.displayName || '알 수 없음'}님이 ${actionText}`,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.error('Failed to log action', e);
    }
  };

  useEffect(() => {
    fetchActiveRules();
    const unsubscribeRooms = onSnapshot(collection(db, 'rooms'), (snapshot) => {
      const roomsArray = snapshot.docs.map(doc => doc.data());
      setRooms(roomsArray);
      setLoading(false);
    });

    const qLogs = query(collection(db, 'logs'), orderBy('createdAt', 'desc'), limit(50));
    const unsubscribeLogs = onSnapshot(qLogs, (snapshot) => {
      setLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubscribeRooms();
      unsubscribeLogs();
    };
  }, []);

  const fetchActiveRules = async () => {
    try {
      const q = query(collection(db, 'ai_rules'), where('isActive', '==', true));
      const snap = await getDocs(q);
      setActiveRules(snap.docs.map(doc => doc.data().text));
    } catch (e) {
      console.error(e);
    }
  };

  // 룸 데이터 로드 직후 (최초 1회) 자동 배정 로직 실행
  useEffect(() => {
    if (isAutoAssignEnabled && !loading && rooms.length > 0 && !hasAutoAssigned) {
      setHasAutoAssigned(true);
      handleAutoAssign(true); // silent = true (알림창 생략)
    }
  }, [loading, rooms, hasAutoAssigned, isAutoAssignEnabled]);

  const handleAutoAssign = async (silent = false) => {
    setIsAssigning(true);
    await fetchActiveRules();
    try {
      // 1. Fetch Reservations from Vercel Engine
      const reservations = await fetchTodayReservations(targetDate, activeRules);
      
      // 이미 파이어베이스(rooms)에 배정된 예약자는 중복 배정하지 않도록 필터링
      const unassignedReservations = reservations.filter(res => {
        const isAlreadyAssigned = rooms.some(r => r.notes && r.notes.includes(res.customerName));
        return !isAlreadyAssigned;
      });

      if (unassignedReservations.length === 0) {
        if (!silent) alert('모든 예약이 이미 배정되었거나, 처리할 예약이 없습니다.');
        setIsAssigning(false);
        return;
      }
      
      // 2. Run AI Auto Assignment Engine
      const { assignments, logs } = await runAutoAssignment(unassignedReservations, rooms);
      
      // 3. Update Firebase with Assigned Results
      if (assignments.length > 0) {
        const batch = writeBatch(db);
        assignments.forEach(assignment => {
          // 객실 업데이트
          assignment.assignedRooms.forEach(roomId => {
            const roomRef = doc(db, 'rooms', roomId);
            batch.update(roomRef, {
              status: 'assigned',
              notes: `[자동 배정] ${assignment.customerName} (${assignment.type})`,
              customerName: assignment.customerName || null,
              stayLength: assignment.stayLength || 1,
              checkInDate: assignment.checkInDate || new Date().toISOString(),
              aiReason: assignment.aiReason || '',
              tags: assignment.tags || [],
              group_name: assignment.group_name || assignment.groupName || null
            });
          });
          if (assignment.reservationId) {
            const resRef = doc(db, 'reservations', String(assignment.reservationId));
            batch.update(resRef, {
              assignedRoom: assignment.assignedRooms.join(', ')
            });
          }
        });
        await batch.commit();
        logAction(`스마트 자동 배정으로 ${assignments.length}개의 예약을 자동 배정했습니다.`);
        if (!silent) alert(`자동 배정이 완료되었습니다!\n총 ${assignments.length}건 배정 완료.\n\n로그:\n` + logs.join('\n'));
      } else {
        if (!silent) {
          const logText = logs && logs.length > 0 ? `\n\n[엔진 로그]\n${logs.join('\n')}` : '';
          alert(`배정할 내역이 없거나 조건에 맞는 빈 방이 부족합니다.${logText}`);
        }
      }
    } catch (error) {
      console.error('Error in auto assignment:', error);
      if (!silent) alert('자동 배정 중 오류가 발생했습니다: ' + error.message);
    } finally {
      setIsAssigning(false);
    }
  };

  const initializeRooms = async () => {
    if (!window.confirm('경고: 객실 데이터를 시트 데이터로 초기화하시겠습니까? 기존 배정 내역이 모두 리셋될 수 있습니다.')) return;
    setIsInitializing(true);
    try {
      const batch = writeBatch(db);
      roomsData.forEach(row => {
        const existingRoom = rooms.find(r => r.id === row.id);
        const roomRef = doc(db, 'rooms', row.id);
        if (existingRoom && (existingRoom.status === 'blocked' || existingRoom.status === 'cleaning')) {
          batch.set(roomRef, { ...row, status: existingRoom.status, notes: existingRoom.notes });
        } else {
          batch.set(roomRef, row);
        }
      });
      await batch.commit();
      alert('객실 초기화가 완료되었습니다.');
    } catch (error) {
      console.error('Error initializing rooms:', error);
      alert('초기화 중 오류가 발생했습니다: ' + error.message);
    } finally {
      setIsInitializing(false);
    }
  };

  const handleUpdateStatus = async (status, as51P = false) => {
    if (!selectedRoom) return;

    let finalNotes = notesInput;

    // Conflict warning: check floor preference in notes vs room floor
    const noteLower = (selectedRoom.notes || '').toLowerCase();
    const wantsHigh = noteLower.includes('고층') || noteLower.includes('높은층');
    const wantsLow = noteLower.includes('저층') || noteLower.includes('낮은층') || noteLower.includes('1층');
    const roomFloor = parseInt(selectedRoom.roomNumber.charAt(0), 10);
    if ((wantsHigh && roomFloor < 3) || (wantsLow && roomFloor > 2)) {
      const confirm = window.confirm('고객 메모에 층수 선호가 있지만 선택한 객실이 조건에 맞지 않습니다. 계속 진행하시겠습니까?');
      if (!confirm) return;
    }

    if ((status === 'blocked' || status === 'cleaning') && selectedRoom.status === 'assigned') {
      const confirmKick = window.confirm(`현재 이 방에 배정된 고객이 있습니다.\n\n이 고객의 방 배정을 취소하고 다른 방으로 자동 재배정 받도록 대기열로 돌려보내시겠습니까?\n\n[확인] 배정 취소 후 상태 변경\n[취소] 고객은 그대로 두고 상태만 변경`);
      if (confirmKick) {
        finalNotes = status === 'blocked' ? '차단됨 (점검/수리)' : '청소 미흡 (준비 중)';
        setNotesInput(finalNotes);
      } else {
        finalNotes = notesInput || selectedRoom.notes;
      }
    } else if (status === 'blocked' && !notesInput) {
      finalNotes = '차단됨 (점검/수리)';
      setNotesInput(finalNotes);
    } else if (status === 'cleaning' && !notesInput) {
      finalNotes = '청소 미흡 (준비 중)';
      setNotesInput(finalNotes);
    } else if (status === 'available') {
      finalNotes = '';
      setNotesInput('');
    } else {
      finalNotes = notesInput || selectedRoom.notes;
    }
    
    try {
      const batch = writeBatch(db);
      const roomRef = doc(db, 'rooms', selectedRoom.id);
      const updateData = {
        status,
        notes: finalNotes,
        aiReason: selectedRoom.aiReason || '',
        tags: selectedRoom.tags || [],
        group_name: selectedRoom.group_name || selectedRoom.groupName || null
      };
      batch.update(roomRef, updateData);

      if (as51P && selectedRoom.adjacent) {
        const adjacentId = `${selectedRoom.building}-${selectedRoom.adjacent}`;
        const adjacentRef = doc(db, 'rooms', adjacentId);
        batch.update(adjacentRef, {
          status,
          notes: `51평 통합 배정 (${selectedRoom.roomNumber}와 연결)`
        });
      }

      await batch.commit();
      
      const statusNames = { 'available': '빈 방', 'assigned': '배정됨', 'blocked': '차단', 'cleaning': '청소/준비중' };
      const statusStr = statusNames[status] || status;
      logAction(`${selectedRoom.roomNumber}호를 [${statusStr}] 상태로 변경했습니다. (메모: ${finalNotes || '없음'})`);

      setSelectedRoom(null);
      setNotesInput('');
      setFeaturesInput([]);
    } catch (error) {
      console.error('Error updating status:', error);
      alert('업데이트 중 오류가 발생했습니다.');
    }
  };

  const AVAILABLE_FEATURES = ['경치좋음', '조용함', '채광좋음', '엘리베이터가까움', '넓은객실'];

  const handleToggleFeature = async (feature) => {
    if (!selectedRoom) return;
    const newFeatures = featuresInput.includes(feature) 
      ? featuresInput.filter(f => f !== feature)
      : [...featuresInput, feature];
    
    setFeaturesInput(newFeatures);
    
    try {
      const roomRef = doc(db, 'rooms', selectedRoom.id);
      await updateDoc(roomRef, { features: newFeatures });
    } catch(e) {
      console.error('특징 업데이트 실패:', e);
    }
  };

  const exportToExcel = async () => {
    try {
      // 동적 임포트로 초기 로딩 속도 최적화
      const ExcelJS = await import('exceljs');
      const { saveAs } = await import('file-saver');

      const response = await fetch('/template.xlsx');
      if (!response.ok) throw new Error('템플릿 파일을 찾을 수 없습니다.');
      const arrayBuffer = await response.arrayBuffer();
      
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(arrayBuffer);
      const worksheet = workbook.worksheets[0]; // 첫 번째 시트

      const targetDateObj = new Date(targetDate);
      const mm = String(targetDateObj.getMonth() + 1).padStart(2, '0');
      const dd = String(targetDateObj.getDate()).padStart(2, '0');
      const dateStringToInsert = `${mm}월 ${dd}일`;

      // 템플릿의 모든 셀을 순회하며 방 번호 및 날짜 찾기
      worksheet.eachRow((row, rowNumber) => {
        row.eachCell((cell, colNumber) => {
          // 상단 날짜 업데이트 (1~10행 내)
          if (rowNumber <= 10 && cell.value) {
            if (typeof cell.value === 'string' && /\d{1,2}월\s*\d{1,2}일/.test(cell.value)) {
              cell.value = cell.value.replace(/\d{1,2}월\s*\d{1,2}일/, dateStringToInsert);
            } else if (cell.value.richText) {
              const hasDate = cell.value.richText.some(rt => /\d{1,2}월\s*\d{1,2}일/.test(rt.text));
              if (hasDate) {
                const newRichText = cell.value.richText.map(rt => ({
                  ...rt,
                  text: rt.text.replace(/\d{1,2}월\s*\d{1,2}일/, dateStringToInsert)
                }));
                cell.value = { richText: newRichText };
              }
            }
          }

          const cellValue = cell.value && typeof cell.value === 'string' ? cell.value.trim() : 
                           (cell.value && cell.value.richText) ? cell.value.richText.map(rt=>rt.text).join('').trim() : 
                           (cell.value ? String(cell.value).trim() : '');

          
          // 숫자로 된 방 번호만 필터링 (예: '401', '203')
          if (!/^\d+$/.test(cellValue)) return;
          
          const matchingRoom = rooms.find(r => r.roomNumber === cellValue);
          
          if (matchingRoom && matchingRoom.status === 'assigned') {
            // 51평형(합쳐진 예약) 여부 판단
            let assignedType = matchingRoom.size;
            if (matchingRoom.isConnecting && matchingRoom.adjacent) {
              const adjacentRoom = rooms.find(r => r.roomNumber === matchingRoom.adjacent && r.building === matchingRoom.building);
              if (adjacentRoom && adjacentRoom.status === 'assigned') {
                const isSameCustomer = matchingRoom.customerName && adjacentRoom.customerName && matchingRoom.customerName === adjacentRoom.customerName;
                const isSameGroup = (matchingRoom.group_name || matchingRoom.groupName) && (adjacentRoom.group_name || adjacentRoom.groupName) && (matchingRoom.group_name || matchingRoom.groupName) === (adjacentRoom.group_name || adjacentRoom.groupName);
                if (isSameCustomer || isSameGroup) {
                  assignedType = '51P';
                }
              }
            }

            // 평수 표시 및 색상 적용 (호수 기준 2칸 아래 셀)
            const sizeRow = worksheet.getRow(rowNumber + 2);
            const sizeCell = sizeRow.getCell(colNumber);
            if (assignedType === '51P') {
              sizeCell.value = '51평';
              sizeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB4C6E7' } }; // Light Blue (합쳐진 색)
            } else if (assignedType === '35P') {
              sizeCell.value = '35평';
              sizeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6E0B4' } }; // Light Green (쪼개진 색)
            } else if (assignedType === '16P') {
              sizeCell.value = '16평';
              sizeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } }; // Light Orange (쪼개진 색)
            }

            // 호수 기준 3칸 아래 셀이 이름(단체명) 입력될 칸
            const targetRowNumber = rowNumber + 3;
            const targetRow = worksheet.getRow(targetRowNumber);
            const targetCell = targetRow.getCell(colNumber);
            
            let guestText = '';
            // 우선순위: 1. 단체/조직명, 2. 개인 이름, 3. 수기 메모
            if (matchingRoom.group_name || matchingRoom.groupName) {
              guestText = matchingRoom.group_name || matchingRoom.groupName;
            } else if (matchingRoom.customerName) {
              guestText = matchingRoom.customerName;
            } else if (matchingRoom.notes) {
              guestText = matchingRoom.notes.replace(/\[자동 배정\]/g, '').trim();
            }
            
            // 연박 텍스트 추가 (예: (1/2))
            if (guestText && matchingRoom.stayLength && matchingRoom.checkInDate) {
              const checkIn = new Date(matchingRoom.checkInDate);
              const target = new Date(targetDate);
              const currentDay = Math.floor((target - checkIn) / (1000 * 60 * 60 * 24)) + 1;
              
              if (matchingRoom.stayLength > 1) {
                guestText += ` (${currentDay}/${matchingRoom.stayLength})`;
              }
            } else if (!matchingRoom.customerName && matchingRoom.notes && matchingRoom.notes.includes('연박') && !matchingRoom.notes.includes('(')) {
               guestText += ' (연박)';
            }
            
            // 잔여 (35P) 등 불필요한 텍스트 제거
            guestText = guestText.replace(/\s*\(\d+[pP]\)/g, '').trim();
            
            // 값 주입 및 폰트 스타일 (글꼴: 맑은 고딕, 기본 크기: 10)
            targetCell.value = guestText;
            targetCell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF000000' } };
            // 글자가 길 경우 셀 크기에 맞게 자동 축소 (shrinkToFit) 적용
            targetCell.alignment = { vertical: 'middle', horizontal: 'center', shrinkToFit: true };
          } else if (matchingRoom && matchingRoom.status === 'blocked') {
            const targetRow = worksheet.getRow(rowNumber + 3);
            const targetCell = targetRow.getCell(colNumber);
            targetCell.value = "고장/차단";
            targetCell.font = { name: '맑은 고딕', size: 10, color: { argb: 'FFFF0000' } };
            targetCell.alignment = { vertical: 'middle', horizontal: 'center' };
          }
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const today = new Date().toISOString().slice(0,10);
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, `객실배정현황_${today}.xlsx`);
    } catch (e) {
      console.error('엑셀 생성 중 오류:', e);
      alert('엑셀 템플릿을 생성하는 중 오류가 발생했습니다: ' + e.message);
    }
  };

  const filteredRooms = activeTab === 'All' ? rooms.slice() : rooms.filter(r => r.building === activeTab);
  const sortedFilteredRooms = filteredRooms.sort((a, b) => parseInt(a.roomNumber) - parseInt(b.roomNumber));
  
  const stats = useMemo(() => {
    let available16P = 0;
    let available35P = 0;
    let unbroken51PSets = 0;
    let availableDisabled51P = 0;
    let blocked = 0;
    let cleaning = 0;
    
    const processedPairs = new Set();

    rooms.filter(r => activeTab === 'All' || r.building === activeTab).forEach(room => {
      if (room.status === 'blocked') blocked++;
      if (room.status === 'cleaning') cleaning++;
      
      if (room.status === 'available') {
        if (room.size === '16P') available16P++;
        if (room.size === '35P') available35P++;
        if (room.size === '51P' && !room.isConnecting) availableDisabled51P++;
        
        if (room.isConnecting && room.adjacent) {
          const adjacentRoom = rooms.find(r => r.building === room.building && r.roomNumber === room.adjacent);
          if (adjacentRoom && adjacentRoom.status === 'available') {
            const pairKey = [room.building, room.roomNumber, adjacentRoom.roomNumber].sort().join('-');
            if (!processedPairs.has(pairKey)) {
              unbroken51PSets++;
              processedPairs.add(pairKey);
            }
          }
        }
      }
    });

    return { available16P, available35P, unbroken51PSets, availableDisabled51P, blocked, cleaning };
  }, [rooms, activeTab]);

  const previewStats = useMemo(() => {
    if (!previewData || !previewData.reservations) return null;
    const stats = { total: previewData.reservations.length, rooms: {} };
    previewData.reservations.forEach(r => {
      stats.rooms[r.roomType] = (stats.rooms[r.roomType] || 0) + 1;
    });
    return stats;
  }, [previewData]);

  const handlePreviewNoteChange = (resId, newNote) => {
    setPreviewData(prev => ({
      ...prev,
      reservations: prev.reservations.map(r => 
        r.reservationId === resId ? { ...r, notes: newNote } : r
      )
    }));
  };

  const handlePreviewRoomTypeChange = (resId, newType) => {
    setPreviewData(prev => ({
      ...prev,
      reservations: prev.reservations.map(r => 
        r.reservationId === resId ? { ...r, roomType: newType } : r
      )
    }));
  };

  const handleGroupSelected = () => {
    if (selectedForGroup.length < 2) return;
    const selectedRes = previewData.reservations.filter(r => selectedForGroup.includes(r.reservationId));
    if (selectedRes.length === 0) return;
    
    let repName = selectedRes[0].group_name || selectedRes[0].groupName || selectedRes[0].agencyName;
    if (!repName) {
      const extracted = selectedRes[0].customerName?.replace(/\(.*?\)/g, '').trim();
      repName = extracted || selectedRes[0].customerName;
    }
    const inputGroupName = window.prompt("지정할 단체명(일행명)을 입력하세요:", repName);
    if (inputGroupName === null) return; 
    const finalGroupName = inputGroupName.trim() || repName;
    const groupText = `[일행: ${finalGroupName} 외 ${selectedRes.length - 1}명]`;
    
    setPreviewData(prev => ({
      ...prev,
      reservations: prev.reservations.map(r => {
        if (selectedForGroup.includes(r.reservationId)) {
          const currentNotes = r.notes || '';
          const newNotes = currentNotes.includes(groupText) ? currentNotes : (currentNotes ? `${currentNotes} ${groupText}` : groupText);
          return { ...r, notes: newNotes, group_name: finalGroupName };
        }
        return r;
      })
    }));
    
    setSelectedForGroup([]);
    alert(`성공적으로 ${selectedRes.length}명을 일행으로 묶었습니다! (메모 자동 추가)`);
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-400">객실 데이터를 불러오는 중...</div>;
  }

  return (
    <div className="inventory-container">
      <div className="inventory-header">
        <div className="ai-avatar-container">
          <img src="/receptionist.png" alt="AI Receptionist" className="ai-avatar" style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border-color)', boxShadow: '0 0 10px rgba(244, 114, 182, 0.4)' }} />
          <div className="ai-speech-bubble" style={{ border: '1px solid rgba(244, 114, 182, 0.3)', boxShadow: '0 4px 15px rgba(244, 114, 182, 0.1)' }}>
            <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#db2777' }}>안녕하세요! 객실 배정을 도와드릴게요 ✨</span><br/>
            <span style={{ fontSize: '12px', opacity: 0.8 }}>우측의 순서대로 버튼을 눌러주세요 ➔</span>
          </div>
        </div>
        
        <div className="flowchart-actions">
          {(rooms.length === 0 || isAdmin) && (
            <div className="flow-step">
              <button onClick={initializeRooms} disabled={isInitializing} className="btn btn-primary">
                {isInitializing ? '⏳ 초기화 중...' : '1. 객실 초기화'}
              </button>
              <svg className="flow-arrow" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </div>
          )}

          <div className="flow-step">
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input 
                type="date" 
                value={targetDate} 
                onChange={(e) => setTargetDate(e.target.value)} 
                onKeyDown={(e) => e.preventDefault()}
                onClick={(e) => e.target.showPicker && e.target.showPicker()}
                className="input-field"
                style={{ width: '130px', padding: '6px 12px', margin: 0 }}
              />
              <button 
                className="btn btn-primary" 
                onClick={async () => {
                  if(!window.confirm(`${targetDate} 기준의 데이터를 가져와 동기화하시겠습니까?`)) return;
                  setIsSettingDB(true);
                  try {
                    const prevDate1 = new Date(new Date(targetDate).getTime() - 86400000).toISOString().split('T')[0];
                    const prevDate2 = new Date(new Date(targetDate).getTime() - 86400000 * 2).toISOString().split('T')[0];
                    
                    const [resToday, resPrev1, resPrev2] = await Promise.all([
                      fetch(`https://belleforet-data.vercel.app/api/v3/roomassign/mariadb-summary?targetDate=${targetDate}`),
                      fetch(`https://belleforet-data.vercel.app/api/v3/roomassign/mariadb-summary?targetDate=${prevDate1}`),
                      fetch(`https://belleforet-data.vercel.app/api/v3/roomassign/mariadb-summary?targetDate=${prevDate2}`)
                    ]);
                    
                    const [jsonToday, jsonPrev1, jsonPrev2] = await Promise.all([
                      resToday.json(),
                      resPrev1.json().catch(() => ({ success: false, data: { reservations: [] } })),
                      resPrev2.json().catch(() => ({ success: false, data: { reservations: [] } }))
                    ]);

                    if (resToday.ok && jsonToday.success) {
                      const allReservations = [
                        ...(jsonToday.data?.reservations || []),
                        ...(jsonPrev1.data?.reservations || []),
                        ...(jsonPrev2.data?.reservations || [])
                      ];
                      const groupInfoMap = {};
                      allReservations.forEach(r => {
                        if (r.notes) {
                          const groupMatch = r.notes.match(/단\s*체\s*명\s*:\s*(.+)/);
                          if (groupMatch) {
                            groupInfoMap[r.customerName] = {
                              groupName: groupMatch[1].trim(),
                              commonNotes: r.notes
                            };
                          }
                        }
                      });

                      const enrichedReservations = jsonToday.data.reservations.map(r => {
                        const info = groupInfoMap[r.customerName];
                        if (info && !r.groupName) {
                          return {
                            ...r,
                            group_name: info.group_name || info.groupName,
                            notes: r.notes ? r.notes : info.commonNotes
                          };
                        }
                        return r;
                      });

                      setPreviewData({ reservations: enrichedReservations, rooms: jsonToday.data.rooms });
                    } else {
                      throw new Error(`MariaDB 연동 실패: API 오류`);
                    }
                  } catch (e) {
                    console.error(e);
                    alert("동기화 중 오류가 발생했습니다: " + e.message);
                  }
                  setIsSettingDB(false);
                }}
                disabled={isSettingDB}
              >
                2. {isSettingDB ? '⏳ 불러오는 중...' : '예약 동기화'}
              </button>
            </div>
          </div>

          <div className="flow-step">
            <svg className="flow-arrow" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            <button className="btn" onClick={() => setIsRulesModalOpen(true)}>3. 특별 규칙</button>
          </div>

          {isAdmin && (
            <>
              <div className="flow-step">
                <svg className="flow-arrow" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.05)', padding: '6px 10px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-light)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-bright)' }}>
                    <input type="checkbox" checked={isAutoAssignEnabled} onChange={toggleAutoAssign} style={{ margin: 0 }}/>
                    자동 배정 {isAutoAssignEnabled ? 'ON' : 'OFF'}
                  </label>
                </div>

                <button onClick={() => handleAutoAssign(false)} disabled={isAssigning} className="btn btn-gradient" style={{ padding: '8px 20px', fontSize: '14px', fontWeight: 'bold' }}>
                  4. {isAssigning ? '✨ 배정 중...' : '✨ 스마트 배정'}
                </button>
              </div>

              <div className="flow-step">
                <svg className="flow-arrow" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                <button onClick={exportToExcel} className="btn">5. 엑셀 다운로드</button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="stats-board">
        <div className="stat-item">
          <span className="stat-label">잔여 16평형:</span>
          <span className="stat-value text-emerald">{stats.available16P}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">잔여 35평형:</span>
          <span className="stat-value text-emerald">{stats.available35P}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">온전한 51평 세트:</span>
          <span className="stat-value text-indigo">{stats.unbroken51PSets}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">장애인 전용 51평형:</span>
          <span className="stat-value text-amber">{stats.availableDisabled51P}</span>
        </div>
        <div className="stat-item" style={{ background: 'rgba(239, 68, 68, 0.05)', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
          <span className="stat-label" style={{ color: '#EF4444' }}>고장/사용불가:</span>
          <span className="stat-value" style={{ color: '#EF4444' }}>{stats.blocked}</span>
        </div>
        <div className="stat-item" style={{ background: 'rgba(245, 158, 11, 0.05)', borderColor: 'rgba(245, 158, 11, 0.2)' }}>
          <span className="stat-label" style={{ color: '#D97706' }}>청소/준비중:</span>
          <span className="stat-value" style={{ color: '#D97706' }}>{stats.cleaning}</span>
        </div>
      </div>

      <div className="tabs-container">
        <button onClick={() => setActiveTab('All')} className={`tab-btn ${activeTab === 'All' ? 'active' : ''}`}>전체</button>
        {['101', '102', '103', '104', '105'].map(building => (
          <button
            key={building}
            onClick={() => setActiveTab(building)}
            className={`tab-btn ${activeTab === building ? 'active' : ''}`}
          >
            {building}동
          </button>
        ))}
      </div>

        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1.5rem', gap: '15px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <label className="input-label" style={{ margin: 0, fontWeight: 'bold' }}>그룹 강조:</label>
            <select 
              value={highlightGroup} 
              onChange={e => {
                const selectedGroup = e.target.value;
                setHighlightGroup(selectedGroup);
                if (selectedGroup) {
                  // 해당 그룹이 배정된 첫 번째 객실을 찾아 해당 동으로 자동 탭 이동
                  const firstRoom = rooms.find(r => (r.group_name || r.groupName) === selectedGroup && r.status === 'assigned');
                  if (firstRoom) {
                    setActiveTab(firstRoom.building);
                  }
                }
              }} 
              style={{ marginLeft: '0.5rem', padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', outline: 'none', cursor: 'pointer' }}
            >
              <option value="">전체 (선택 안함)</option>
              {groupOptions.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center' }}>
            <label className="input-label" style={{ margin: 0, fontWeight: 'bold' }}>방 찾기:</label>
            <input 
              type="text" 
              value={searchQuery} 
              onChange={e => {
                setSearchQuery(e.target.value);
                if (e.target.value.trim().length > 1) {
                  const term = e.target.value.trim().toLowerCase();
                  const foundRoom = rooms.find(r => 
                    r.status === 'assigned' && 
                    (
                      (r.customerName && r.customerName.toLowerCase().includes(term)) || 
                      (r.group_name && r.group_name.toLowerCase().includes(term)) ||
                      (r.notes && r.notes.toLowerCase().includes(term))
                    )
                  );
                  if (foundRoom) setActiveTab(foundRoom.building);
                }
              }} 
              placeholder="고객명 또는 단체명 검색"
              className="input-field"
              style={{ marginLeft: '0.5rem', width: '180px', padding: '6px 12px', margin: 0 }}
            />
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(244, 114, 182, 0.05)', padding: '6px 14px', borderRadius: '30px', border: '1px solid rgba(244, 114, 182, 0.2)' }}>
            <img src="/receptionist.png" alt="AI Receptionist" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', border: '1px solid #f472b6' }} />
            <span style={{ fontSize: '13px', color: 'var(--text-color)', lineHeight: '1.4' }}>
              그룹 강조나 이름 검색을 통해 방을 빠르게 찾고 해당 동으로 <b>자동 이동</b>할 수 있습니다!
            </span>
          </div>
        </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px' }}>
        <div className="room-grid-wrapper">
          {activeTab === 'All' ? (
          ['101', '102', '103', '104', '105'].map(building => {
            const buildingRooms = sortedFilteredRooms.filter(r => String(r.building) === building);
            if (buildingRooms.length === 0) return null;
            return (
              <div key={building} style={{ marginBottom: '32px' }}>
                <h3 style={{ color: 'var(--primary-color)', borderBottom: '2px solid var(--border-color)', paddingBottom: '8px', marginBottom: '16px', paddingLeft: '8px', fontSize: '18px' }}>
                  🏢 {building}동
                </h3>
                <div className="room-grid">
                  {buildingRooms.map(room => (
            <div
              key={room.id}
              onClick={() => {
                setSelectedRoom(room);
                setNotesInput(room.notes || '');
                setFeaturesInput(room.features || []);
              }}
              className={`room-card ${room.status}`}
              style={highlightGroup && (room.group_name || room.groupName) === highlightGroup ? { border: '2px solid #fbbf24' } : {}}
            >
              <div className="room-number">
                 {room.roomNumber}
                 {room.aiReason && (
                   <span className="tooltip-icon" title={room.aiReason}>✨</span>
                 )}
                 {room.tags && room.tags.includes('VIP') && (
                   <span className="tooltip-icon" title="VIP 고객">👑</span>
                 )}
                 {room.tags && room.tags.includes('주의') && (
                   <span className="tooltip-icon" title="주의 고객">🚨</span>
                 )}
                 {room.tags && room.tags.includes('청소긴급') && (
                   <span className="tooltip-icon" title="청소 긴급">🧹</span>
                 )}
               </div>
              <div className="room-info">{room.size} ({room.bedType})</div>
              
              {room.isConnecting && (
                <div className="connecting-info">
                  🔗 커넥팅 ({room.adjacent})
                </div>
              )}
              
              {room.features && room.features.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', marginTop: '4px' }}>
                  {room.features.map(feat => (
                    <span key={feat} style={{ background: '#454545', color: '#fff', padding: '2px 4px', borderRadius: '2px', fontSize: '10px' }}>
                      {feat}
                    </span>
                  ))}
                </div>
              )}
              
              {(room.customerName || room.notes) && (
                <div className="room-notes" title={room.notes}>
                  {room.customerName ? (
                    room.group_name || room.groupName ? `${room.customerName} | ${room.group_name || room.groupName}` : room.customerName
                  ) : (
                    room.notes.replace(/\[자동 배정\]\s*/g, '').replace(/\s*\(\d+[pP]\)$/g, '').trim()
                  )}
                </div>
              )}
            </div>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <div className="room-grid">
            {sortedFilteredRooms.map(room => (
              <div
                key={room.id}
                className={`room-card ${room.status}`}
                style={
                  (highlightGroup && (room.group_name || room.groupName) === highlightGroup) || 
                  (searchQuery && room.status === 'assigned' && (
                    (room.customerName && room.customerName.toLowerCase().includes(searchQuery.toLowerCase())) ||
                    (room.group_name && room.group_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
                    (room.notes && room.notes.toLowerCase().includes(searchQuery.toLowerCase()))
                  )) 
                  ? { border: '2px solid #fbbf24', boxShadow: '0 0 10px rgba(251, 191, 36, 0.4)' } 
                  : {}
                }
                onClick={() => {
                  setSelectedRoom(room);
                  setNotesInput(room.notes || '');
                  setFeaturesInput(room.features || []);
                }}
              >
                <div className="room-number">
                   {room.roomNumber}
                   {room.aiReason && (
                     <span className="tooltip-icon" title={room.aiReason}>✨</span>
                   )}
                   {room.tags && room.tags.includes('VIP') && (
                     <span className="tooltip-icon" title="VIP 고객">👑</span>
                   )}
                   {room.tags && room.tags.includes('주의') && (
                     <span className="tooltip-icon" title="주의 고객">🚨</span>
                   )}
                   {room.tags && room.tags.includes('청소긴급') && (
                     <span className="tooltip-icon" title="청소 긴급">🧹</span>
                   )}
                 </div>
                <div className="room-info">{room.size} ({room.bedType})</div>
                
                {room.isConnecting && (
                  <div className="connecting-info">
                    🔗 커넥팅 ({room.adjacent})
                  </div>
                )}
                
                {room.features && room.features.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', marginTop: '4px' }}>
                    {room.features.map(feat => (
                      <span key={feat} style={{ background: '#454545', color: '#fff', padding: '2px 4px', borderRadius: '2px', fontSize: '10px' }}>
                        {feat}
                      </span>
                    ))}
                  </div>
                )}
                
                {(room.customerName || room.notes) && (
                  <div className="room-notes" title={room.notes}>
                    {room.customerName ? (
                      room.group_name || room.groupName ? `${room.customerName} | ${room.group_name || room.groupName}` : room.customerName
                    ) : (
                      room.notes.replace(/\[자동 배정\]\s*/g, '').replace(/\s*\(\d+[pP]\)$/g, '').trim()
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity Log Panel */}
      <div className="activity-log-panel glass-panel" style={{ maxHeight: '800px', overflowY: 'auto' }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-bright)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
          📜 실시간 활동 기록
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          {logs.map(log => (
            <div key={log.id} style={{ fontSize: '0.85rem', padding: '0.8rem', background: 'var(--bg-dark)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.3rem' }}>
                {log.createdAt?.toDate().toLocaleString() || '방금 전'}
              </div>
              <div style={{ color: 'var(--text-main)', lineHeight: '1.4' }}>
                {log.text}
              </div>
            </div>
          ))}
          {logs.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', marginTop: '2rem' }}>기록이 없습니다.</p>
          )}
        </div>
      </div>
      </div>
      
      {/* Control Modal */}
      {selectedRoom && (
        <div className="modal-overlay" onClick={() => setSelectedRoom(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">
              {selectedRoom.building}동 {selectedRoom.roomNumber}호 관리
            </h3>
            <p className="modal-subtitle">
              타입: {selectedRoom.size} ({selectedRoom.bedType}) 
              {selectedRoom.isConnecting && ` / 커넥팅 인접: ${selectedRoom.adjacent}호`}
            </p>
            
            <div style={{ marginBottom: '1rem' }}>
              <label className="input-label">메모 (고객명 등)</label>
              <input 
                type="text" 
                value={notesInput}
                onChange={e => setNotesInput(e.target.value)}
                className="input-field"
                placeholder="예: 홍길동 고객님"
              />
            </div>
            
            <div style={{ marginBottom: '1.5rem', background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px' }}>
              <label className="input-label" style={{ marginBottom: '0.5rem', display: 'block' }}>🌟 이 방만의 특별한 장점 (AI 배정 참조용)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {AVAILABLE_FEATURES.map(feat => (
                  <button
                    key={feat}
                    onClick={() => handleToggleFeature(feat)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '20px',
                      border: featuresInput.includes(feat) ? '1px solid #fbbf24' : '1px solid var(--border-color)',
                      background: featuresInput.includes(feat) ? 'rgba(251, 191, 36, 0.2)' : 'transparent',
                      color: featuresInput.includes(feat) ? '#fbbf24' : 'var(--text-muted)',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      transition: 'all 0.2s'
                    }}
                  >
                    {featuresInput.includes(feat) ? '✓ ' : '+ '}{feat}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>선택하신 특징은 즉시 자동 저장되며, AI가 고객 메모와 매칭하여 배정합니다.</p>
            </div>
            
            <div>
              <button onClick={() => handleUpdateStatus('available')} className="modal-btn available">
                ✅ 빈 방으로 전환 (기존 고객 배정 취소)
              </button>
              
              <button onClick={() => handleUpdateStatus('assigned', false)} className="modal-btn assigned">
                🟦 개별 객실로 배정 ({selectedRoom.size}만 배정)
              </button>

              {selectedRoom.isConnecting && (
                <button onClick={() => handleUpdateStatus('assigned', true)} className="modal-btn connecting">
                  🟪 51평 통합 배정 ({selectedRoom.roomNumber} + {selectedRoom.adjacent} 동시 배정)
                </button>
              )}
              
              {isAdmin && (
                <>
                  <button onClick={() => handleUpdateStatus('blocked')} className="modal-btn blocked">
                    🚫 객실 차단 (수리 등)
                  </button>
                  
                  <button onClick={() => handleUpdateStatus('cleaning')} className="modal-btn" style={{ background: '#F59E0B', color: 'white', borderColor: '#D97706', padding: '0.8rem', borderRadius: 'var(--radius-md)', fontWeight: '600', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s ease', border: '1px solid transparent' }}>
                    🧽 청소 미흡 (준비 중)
                  </button>
                </>
              )}
            </div>
            
            <button onClick={() => setSelectedRoom(null)} className="modal-btn close">
              닫기
            </button>
          </div>
        </div>
      )}
      
      {/* Sync Preview Modal */}
      {previewData && (
        <div className="modal-overlay" style={{ alignItems: 'flex-start', paddingTop: '5vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', maxWidth: '1400px', width: '95%', alignItems: 'flex-start', justifyContent: 'center', paddingBottom: '5vh' }}>
            
            {/* AI Guide Panel */}
            {/* AI Guide Panel */}
            <div style={{ 
              width: '340px', 
              background: 'rgba(43, 34, 60, 0.85)', 
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid var(--border-light)', 
              borderRadius: 'var(--radius-lg)', 
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
              animation: 'scaleUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
              flexShrink: 0
            }}>
              <img src="/receptionist.png" alt="AI Receptionist" style={{ width: '120px', height: '120px', borderRadius: '50%', objectFit: 'cover', border: '3px solid #f472b6', marginBottom: '16px', boxShadow: '0 0 20px rgba(244, 114, 182, 0.3)' }} />
              <div style={{ 
                background: 'linear-gradient(135deg, rgba(244, 114, 182, 0.15), rgba(192, 132, 252, 0.15))', 
                border: '1px solid rgba(244, 114, 182, 0.3)', 
                padding: '20px', 
                borderRadius: '16px', 
                color: '#ffffff', 
                fontSize: '13px', 
                lineHeight: '1.6',
                position: 'relative',
                width: '100%'
              }}>
                <div style={{ position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)', borderBottom: '10px solid rgba(244, 114, 182, 0.3)', borderLeft: '10px solid transparent', borderRight: '10px solid transparent' }}></div>
                <p style={{ fontWeight: 'bold', fontSize: '16px', color: '#f472b6', marginBottom: '12px', textAlign: 'center' }}>데이터를 동기화할까요?</p>
                <p style={{ marginBottom: '16px', color: '#e5e7eb', textAlign: 'center' }}>이 리스트는 오늘 아침 기준의 PMS 예약 데이터입니다.</p>
                
                <div style={{ background: 'rgba(0,0,0,0.4)', padding: '16px', borderRadius: '8px', borderLeft: '3px solid #c084fc', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto' }}>
                  <p style={{ fontWeight: 'bold', color: '#c084fc', margin: 0, fontSize: '14px' }}>💡 100% 활용하는 AI 배정 꿀팁!</p>
                  
                  <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '6px' }}>
                    <p style={{ fontWeight: '600', color: '#f472b6', marginBottom: '4px', fontSize: '12px' }}>🧳 연박 자동 보호</p>
                    <p style={{ color: '#e5e7eb', fontSize: '11.5px', margin: 0, lineHeight: '1.4' }}>
                      <strong>연박 고객</strong>은 AI가 가장 최우선으로 배정하며, 며칠 머무르시는 동안 중간에 방이 바뀌지 않도록 똑똑하게 동일 객실을 찜해둡니다.
                    </p>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '6px' }}>
                    <p style={{ fontWeight: '600', color: '#f472b6', marginBottom: '4px', fontSize: '12px' }}>🤝 가족 & 일행 찰떡 배정</p>
                    <p style={{ color: '#e5e7eb', fontSize: '11.5px', margin: 0, lineHeight: '1.4' }}>
                      일행이 있다면 메모란에 <strong>"김씨가족"</strong> 처럼 공통된 단어를 적어주시거나, 좌측 체크박스로 여러 명을 선택 후 <strong>[일행으로 묶기]</strong>를 눌러주세요. 옆방이나 가까운 층으로 알아서 붙여 드립니다!
                    </p>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '6px' }}>
                    <p style={{ fontWeight: '600', color: '#f472b6', marginBottom: '4px', fontSize: '12px' }}>🗣️ 자연어 처리 지원</p>
                    <p style={{ color: '#e5e7eb', fontSize: '11.5px', margin: 0, lineHeight: '1.4' }}>
                      "조용한 고층 부탁드려요", "엘리베이터 가까운 곳" 처럼 <strong>평소 쓰시던 자연스러운 말투</strong>로 메모를 남기셔도 AI가 문맥을 찰떡같이 이해하고 최적의 객실을 찾아냅니다.
                    </p>
                  </div>
                  
                  <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '6px' }}>
                    <p style={{ fontWeight: '600', color: '#f472b6', marginBottom: '4px', fontSize: '12px' }}>👑 VIP & 특별 고객 우대</p>
                    <p style={{ color: '#e5e7eb', fontSize: '11.5px', margin: 0, lineHeight: '1.4' }}>
                      방문 횟수가 많거나 특별한 분이신가요? 단골 고객님께는 전망이 더 좋거나 넓은 프리미엄 객실을 우선적으로 배정해 드립니다.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Existing Modal Content */}
            <div className="modal-content" style={{ flex: 1, maxWidth: '1000px', maxHeight: '90vh', overflowY: 'auto', margin: 0, transform: 'none', animation: 'scaleUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards' }}>
              <h3 className="modal-title" style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>
                📋 PMS 예약 데이터 동기화 미리보기
              </h3>
            <p className="modal-subtitle" style={{ marginBottom: '1.5rem', lineHeight: '1.5', color: '#fbbf24' }}>
              ⚠️ 본 리스트는 <strong>오늘 아침 기준의 PMS 예약 데이터</strong>입니다. 실시간 연동이 아니므로 오늘 아침 이후에 추가된 당일 예약 등은 누락되어 있을 수 있습니다. 직원용 비교 대조를 위해 창이 고정 유지됩니다.
            </p>

            {/* Subtotal Area */}
            {previewStats && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem', padding: '1rem', background: 'rgba(52, 211, 153, 0.1)', borderRadius: '8px', border: '1px solid rgba(52, 211, 153, 0.3)' }}>
                <span style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>총 대기 고객: {previewStats.total}명</span>
                <span style={{ color: 'var(--text-muted)' }}>|</span>
                {Object.entries(previewStats.rooms).sort((a,b)=>a[0].localeCompare(b[0])).map(([type, count]) => (
                  <span key={type} style={{ color: 'var(--text-main)' }}>{type}: <span style={{ color: '#059669', fontWeight: 'bold' }}>{count}</span>개</span>
                ))}
              </div>
            )}
            
            <div style={{ background: 'var(--bg-hover)', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', border: '1px solid var(--border-light)' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', minHeight: '36px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: '500' }}>
                  {selectedForGroup.length > 0 ? `${selectedForGroup.length}명 선택됨` : '리스트에서 일행을 체크하여 하나로 묶어보세요.'}
                </span>
                {selectedForGroup.length >= 2 && (
                  <button 
                    onClick={handleGroupSelected}
                    style={{ background: '#4F46E5', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    🤝 선택한 {selectedForGroup.length}명 일행으로 묶기
                  </button>
                )}
              </div>

              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', color: 'var(--text-main)' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.5rem', width: '40px', textAlign: 'center' }}>
                      <input 
                        type="checkbox" 
                        checked={selectedForGroup.length === previewData.reservations.length && previewData.reservations.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedForGroup(previewData.reservations.map(r => r.reservationId));
                          else setSelectedForGroup([]);
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                    </th>
                    <th style={{ padding: '0.5rem' }}>예약자명</th>
                    <th style={{ padding: '0.5rem' }}>선택 평형</th>
                    <th style={{ padding: '0.5rem' }}>예약/투숙 정보</th>
                    <th style={{ padding: '0.5rem' }}>요청 메모</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.reservations.map((res, index) => (
                    <tr key={res.reservationId} style={{ borderBottom: '1px solid var(--border-light)', background: selectedForGroup.includes(res.reservationId) ? 'rgba(244, 114, 182, 0.1)' : 'transparent', transition: 'background 0.2s' }}>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedForGroup.includes(res.reservationId)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedForGroup(prev => [...prev, res.reservationId]);
                            else setSelectedForGroup(prev => prev.filter(id => id !== res.reservationId));
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 'bold', color: 'var(--text-main)' }}>
                        <span style={{ color: 'var(--text-muted)', marginRight: '8px', fontSize: '0.85rem' }}>{index + 1}</span>
                        {res.group_name || res.groupName || res.agencyName ? (
                          <>
                            <span style={{ color: '#F87171' }}>{res.group_name || res.groupName || res.agencyName}</span>
                            <span style={{ fontSize: '0.8rem', color: '#9CA3AF', marginLeft: '6px', fontWeight: 'normal' }}>({res.customerName})</span>
                          </>
                        ) : (
                          (res.customerName?.includes('(') && res.customerName.replace(/\(.*?\)/g, '').trim() ? res.customerName.replace(/\(.*?\)/g, '').trim() : res.customerName)
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <select 
                          value={res.roomType || ''}
                          onChange={e => handlePreviewRoomTypeChange(res.reservationId, e.target.value)}
                          style={{ 
                            background: res.roomType ? 'rgba(99, 102, 241, 0.2)' : 'rgba(239, 68, 68, 0.2)', 
                            color: res.roomType ? '#818cf8' : '#fca5a5', 
                            padding: '4px 8px', 
                            borderRadius: '4px', 
                            fontSize: '0.85rem',
                            border: res.roomType ? 'none' : '1px solid #ef4444',
                            outline: 'none',
                            cursor: 'pointer',
                            colorScheme: 'dark'
                          }}
                        >
                          <option value="" disabled>평형 선택 필요!</option>
                          <option value="16평">16평</option>
                          <option value="35평">35평</option>
                          <option value="51평">51평</option>
                        </select>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.9rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '4px' }}>
                          {res.marketChannel && (
                            <span style={{ display: 'inline-block', color: '#60A5FA', background: 'rgba(96,165,250,0.1)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                              {res.marketChannel}
                            </span>
                          )}
                          {Boolean(res.is_member) || res.is_member === 1 ? (
                            <span style={{ display: 'inline-block', color: '#FCD34D', fontWeight: 'bold', fontSize: '0.8rem', padding: '2px 0' }}>👑 회원</span>
                          ) : (
                            <span style={{ display: 'inline-block', color: '#9CA3AF', fontSize: '0.8rem', padding: '2px 0' }}>👤 비회원</span>
                          )}
                          {Boolean(res.has_golf) || res.has_golf === 1 ? (
                            <span style={{ display: 'inline-block', color: '#34D399', fontWeight: 'bold', fontSize: '0.8rem', padding: '2px 0' }}>⛳ 골프</span>
                          ) : (
                            <span style={{ display: 'inline-block', color: '#9CA3AF', fontSize: '0.8rem', padding: '2px 0' }}>-</span>
                          )}
                        </div>
                        {(() => {
                          const checkIn = new Date(res.checkInDate || targetDate);
                          const target = new Date(targetDate);
                          const currentDay = Math.floor((target - checkIn) / (1000 * 60 * 60 * 24)) + 1;
                          const isMultiNight = res.stayLength > 1;
                          const checkOutStr = new Date(res.checkOutDate || checkIn).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {isMultiNight ? (
                                <span style={{ fontSize: '0.8rem', color: '#10B981', background: 'rgba(16,185,129,0.1)', padding: '2px 6px', borderRadius: '4px', alignSelf: 'flex-start' }}>
                                  🛌 연박 ({res.stayLength}박) • 오늘 {currentDay}일차 • {checkOutStr} 퇴실
                                </span>
                              ) : (
                                <span style={{ fontSize: '0.8rem', color: '#9CA3AF', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px', alignSelf: 'flex-start' }}>
                                  단박 ({checkOutStr} 퇴실)
                                </span>
                              )}
                              {res.assignedRoom && (
                                <span style={{ fontSize: '0.8rem', color: '#FCD34D', background: 'rgba(252,211,77,0.1)', border: '1px solid rgba(252,211,77,0.2)', padding: '2px 6px', borderRadius: '4px', alignSelf: 'flex-start' }}>
                                  ✔️ 사용중인 방: {res.assignedRoom}호
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.9rem', color: '#E5E7EB' }}>
                        <textarea 
                          value={res.notes || ''} 
                          onChange={e => handlePreviewNoteChange(res.reservationId, e.target.value)}
                          placeholder="메모..."
                          style={{ width: '100%', minHeight: '60px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#E5E7EB', padding: '6px 8px', borderRadius: '4px', outline: 'none', transition: 'all 0.2s', resize: 'vertical', fontSize: '0.8rem', lineHeight: '1.4' }}
                          onFocus={e => e.target.style.border = '1px solid #6366f1'}
                          onBlur={e => e.target.style.border = '1px solid rgba(255,255,255,0.1)'}
                        />
                      </td>
                    </tr>
                  ))}
                  {previewData.reservations.length === 0 && (
                    <tr>
                      <td colSpan="5" style={{ padding: '1rem', textAlign: 'center', color: '#9CA3AF' }}>예약 데이터가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button 
                onClick={async () => {
                  try {
                    const batch = writeBatch(db);
                    
                    // 1. 예약 세팅 (Upsert)
                    previewData.reservations.forEach(m => {
                      batch.set(doc(collection(db, 'reservations'), String(m.reservationId)), m);
                    });
                    
                    // 2. 객실 상태 세팅 (Update)
                    previewData.rooms.forEach(r => {
                      batch.update(doc(db, 'rooms', String(r.id)), { status: r.status, notes: r.notes });
                    });
  
                    await batch.commit();
                    setPreviewData(null);
                    alert("데이터 동기화 완료! 스마트 배정을 실행해 보세요.");
                  } catch (err) {
                    console.error(err);
                    alert("최종 동기화 중 오류가 발생했습니다.");
                  }
                }} 
                className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}
              >
                ✅ 이 데이터로 현황판 동기화 확정
              </button>
              <button onClick={() => setPreviewData(null)} className="btn" style={{ flex: 1, justifyContent: 'center', background: 'rgba(255,255,255,0.1)', color: 'white' }}>
                ❌ 취소
              </button>
            </div>
            </div>
          </div>
        </div>
      )}
      
      <CustomRulesModal 
        isOpen={isRulesModalOpen} 
        onClose={() => {
          setIsRulesModalOpen(false);
          fetchActiveRules(); // 모달 닫힐 때 규칙 갱신
        }} 
      />
    </div>
  );
}

export default RoomInventory;
