import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, doc, writeBatch, onSnapshot, getDocs, query, where } from 'firebase/firestore';
import roomsData from '../data/roomsData.json';

import { fetchTodayReservations } from '../services/vercelApi';
import { runAutoAssignment } from '../utils/autoAssigner';
import * as XLSX from 'xlsx';
import CustomRulesModal from './CustomRulesModal';

function RoomInventory({ isAdmin }) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('101');
  const [isInitializing, setIsInitializing] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [notesInput, setNotesInput] = useState('');

  const [hasAutoAssigned, setHasAutoAssigned] = useState(false);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [activeRules, setActiveRules] = useState([]);
  const [isSettingDB, setIsSettingDB] = useState(false);
  
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

  useEffect(() => {
    fetchActiveRules();
    const unsubscribe = onSnapshot(collection(db, 'rooms'), (snapshot) => {
      const roomsArray = snapshot.docs.map(doc => doc.data());
      setRooms(roomsArray);
      setLoading(false);
    });
    return () => unsubscribe();
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
      const reservations = await fetchTodayReservations(activeRules);
      
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
              notes: `[자동 배정] ${assignment.customerName} (${assignment.type})`
            });
          });
          // 가상 예약 데이터 업데이트
          if (assignment.reservationId && assignment.reservationId.startsWith('RES-MOCK')) {
            const resRef = doc(db, 'reservations', assignment.reservationId);
            batch.update(resRef, {
              assignedRoom: assignment.assignedRooms.join(', ')
            });
          }
        });
        await batch.commit();
        if (!silent) alert(`자동 배정이 완료되었습니다!\n총 ${assignments.length}건 배정 완료.\n\n로그:\n` + logs.join('\n'));
      } else {
        if (!silent) alert('배정할 내역이 없거나 가능한 빈 방이 없습니다.');
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
        const roomRef = doc(db, 'rooms', row.id);
        batch.set(roomRef, row);
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
    
    try {
      const batch = writeBatch(db);
      const roomRef = doc(db, 'rooms', selectedRoom.id);
      
      batch.update(roomRef, { 
        status, 
        notes: notesInput || (status === 'available' ? '' : selectedRoom.notes)
      });

      // Handle Lock-off coupling if Assigning as 51P
      if (as51P && selectedRoom.adjacent) {
        const adjacentId = `${selectedRoom.building}-${selectedRoom.adjacent}`;
        const adjacentRef = doc(db, 'rooms', adjacentId);
        batch.update(adjacentRef, {
          status,
          notes: `51평 통합 배정 (${selectedRoom.roomNumber}와 연결)`
        });
      }

      await batch.commit();
      setSelectedRoom(null);
      setNotesInput('');
    } catch (error) {
      console.error('Error updating status:', error);
      alert('업데이트 중 오류가 발생했습니다.');
    }
  };

  const exportToExcel = () => {
    const exportData = rooms.map(room => ({
      '동': room.building,
      '호수': room.roomNumber,
      '객실 타입': room.size,
      '베드 타입': room.bedType,
      '상태': room.status === 'available' ? '빈 방' : room.status === 'assigned' ? '배정됨' : '차단됨',
      '커넥팅 연결호수': room.isConnecting ? room.adjacent : '해당없음',
      '메모(고객명)': room.notes || ''
    }));
    
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "객실배정현황");
    const today = new Date().toISOString().slice(0,10);
    XLSX.writeFile(wb, `객실배정현황_${today}.xlsx`);
  };

  const filteredRooms = rooms.filter(r => r.building === activeTab).sort((a, b) => parseInt(a.roomNumber) - parseInt(b.roomNumber));
  
  // Calculate Stats
  const stats = useMemo(() => {
    let available16P = 0;
    let available35P = 0;
    let unbroken51PSets = 0;
    let availableDisabled51P = 0;
    
    const processedPairs = new Set();

    rooms.filter(r => r.building === activeTab).forEach(room => {
      if (room.status === 'available') {
        if (room.size === '16P') available16P++;
        if (room.size === '35P') available35P++;
        if (room.size === '51P' && !room.isConnecting) availableDisabled51P++;
        
        // Check unbroken connecting set
        if (room.isConnecting && room.adjacent) {
          const adjacentRoom = rooms.find(r => r.building === activeTab && r.roomNumber === room.adjacent);
          if (adjacentRoom && adjacentRoom.status === 'available') {
            const pairKey = [room.roomNumber, adjacentRoom.roomNumber].sort().join('-');
            if (!processedPairs.has(pairKey)) {
              unbroken51PSets++;
              processedPairs.add(pairKey);
            }
          }
        }
      }
    });

    return { available16P, available35P, unbroken51PSets, availableDisabled51P };
  }, [rooms, activeTab]);

  if (loading) {
    return <div className="p-8 text-center text-gray-400">객실 데이터를 불러오는 중...</div>;
  }

  return (
    <div className="inventory-container relative">
      <div className="inventory-header animate-float-up">
        <h1 className="header-title">객실 배정 AI 현황판</h1>
        
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button 
            className="btn" 
            style={{ border: '1px solid var(--accent-indigo)', color: 'var(--accent-indigo)' }}
            onClick={() => setIsRulesModalOpen(true)}
          >
            🤖 AI 특수 규칙
          </button>
          
          <button 
            className="btn" 
            style={{ border: '1px solid #34D399', color: '#34D399' }}
            onClick={async () => {
              if(!window.confirm("100명의 가상 예약 데이터를 Firebase에 생성하시겠습니까?")) return;
              setIsSettingDB(true);
              try {
                const { generateMockReservations } = await import('../data/mockReservations');
                const mocks = generateMockReservations();
                const batch = writeBatch(db);
                mocks.forEach(m => {
                  batch.set(doc(collection(db, 'reservations'), m.reservationId), m);
                });
                await batch.commit();
                alert("100명 세팅 완료! 수동 재배정 실행을 눌러 AI 배정을 테스트하세요.");
              } catch (e) {
                console.error(e);
                alert("세팅 실패");
              }
              setIsSettingDB(false);
            }}
            disabled={isSettingDB}
          >
            {isSettingDB ? '⏳ 세팅 중...' : '🧪 100명 고객 세팅'}
          </button>

          {isAdmin && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'white', fontWeight: 'bold' }}>
                <input 
                  type="checkbox" 
                  checked={isAutoAssignEnabled} 
                  onChange={toggleAutoAssign} 
                  style={{ width: '20px', height: '20px', accentColor: '#6366f1' }}
                />
                자동 배정 {isAutoAssignEnabled ? 'ON' : 'OFF'}
              </label>
              
              <button 
                onClick={() => handleAutoAssign(false)} 
                disabled={isAssigning}
                className="btn btn-gradient"
              >
                {isAssigning ? '✨ AI 배정 중...' : '✨ 수동 재배정 실행'}
              </button>
              <button 
                onClick={exportToExcel}
                className="btn btn-primary"
              >
                📊 엑셀 다운로드
              </button>
            </>
          )}

          {(rooms.length === 0 || isAdmin) && (
            <button 
              onClick={initializeRooms} 
              disabled={isInitializing}
              className="btn btn-primary"
            >
              {isInitializing ? '초기화 중...' : '데이터 (강제) 재초기화'}
            </button>
          )}
        </div>
      </div>

      {/* Stats Board */}
      <div className="stats-board">
        <div className="stat-item">
          <div className="stat-label">잔여 16평형</div>
          <div className="stat-value text-emerald">{stats.available16P}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">잔여 35평형</div>
          <div className="stat-value text-emerald">{stats.available35P}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">온전한 51평 세트 (예약가능)</div>
          <div className="stat-value text-indigo">{stats.unbroken51PSets}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">장애인 전용 51평형</div>
          <div className="stat-value text-amber">{stats.availableDisabled51P}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-container">
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

      {/* Grid */}
      <div className="room-grid">
        {filteredRooms.map(room => (
          <div 
            key={room.id}
            onClick={() => {
              setSelectedRoom(room);
              setNotesInput(room.notes || '');
            }}
            className={`room-card ${room.status}`}
          >
            <div className="room-number">{room.roomNumber}</div>
            <div className="room-info">{room.size} ({room.bedType})</div>
            
            <div className="room-status-badge">
              {room.status === 'available' ? '빈 방' :
               room.status === 'assigned' ? '배정됨' : '차단됨'}
            </div>
            
            {room.isConnecting && (
              <div className="connecting-info">
                🔗 커넥팅 ({room.adjacent})
              </div>
            )}
            
            {room.notes && (
              <div className="room-notes" title={room.notes}>
                📝 {room.notes}
              </div>
            )}
          </div>
        ))}
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
            
            <div>
              <button onClick={() => handleUpdateStatus('available')} className="modal-btn available">
                ✅ 빈 방으로 전환 (예약 취소)
              </button>
              
              <button onClick={() => handleUpdateStatus('assigned', false)} className="modal-btn assigned">
                🟦 개별 객실로 배정 ({selectedRoom.size}만 배정)
              </button>

              {selectedRoom.isConnecting && (
                <button onClick={() => handleUpdateStatus('assigned', true)} className="modal-btn connecting">
                  🟪 51평 통합 배정 ({selectedRoom.roomNumber} + {selectedRoom.adjacent} 동시 배정)
                </button>
              )}
              
              <button onClick={() => handleUpdateStatus('blocked')} className="modal-btn blocked">
                🚫 객실 차단 (수리 등)
              </button>
            </div>
            
            <button onClick={() => setSelectedRoom(null)} className="modal-btn close">
              닫기
            </button>
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
