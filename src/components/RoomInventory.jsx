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
  const [previewData, setPreviewData] = useState(null);
  
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
          // 예약 원장에 배정된 객실 번호 업데이트
          if (assignment.reservationId) {
            const resRef = doc(db, 'reservations', String(assignment.reservationId));
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
        <h1 className="header-title">스마트 객실 배정 현황판</h1>
        
        {/* Flowchart Layout */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '1.5rem 0', padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <h3 style={{ color: 'var(--text-main)', marginBottom: '1.5rem', fontSize: '1.1rem', fontWeight: '600' }}>📌 배정 진행 순서</h3>

          {(rooms.length === 0 || isAdmin) && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', fontSize: '1rem', fontWeight: 'bold', color: 'var(--text-main)' }}>1</div>
                <button 
                  onClick={initializeRooms} 
                  disabled={isInitializing}
                  className="btn btn-primary"
                  style={{ width: '220px', justifyContent: 'center' }}
                >
                  {isInitializing ? '초기화 중...' : '객실 데이터 초기화'}
                </button>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>기존 배정 내역을 모두 리셋하고 빈 객실 상태로 되돌립니다.</span>
              </div>
              <div style={{ width: '32px', textAlign: 'center', color: '#94a3b8', fontSize: '1.2rem', paddingBottom: '0.5rem', paddingTop: '0.5rem' }}>↓</div>
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', fontSize: '1rem', fontWeight: 'bold', color: 'var(--text-main)' }}>{(rooms.length === 0 || isAdmin) ? '2' : '1'}</div>
            <button 
              className="btn" 
              style={{ width: '220px', justifyContent: 'center', border: '1px solid #34D399', color: '#34D399' }}
              onClick={async () => {
                if(!window.confirm("MariaDB 요약 테이블에서 최신 데이터를 가져와 현황판을 동기화하시겠습니까?")) return;
                setIsSettingDB(true);
                try {
                  const res = await fetch('https://belleforet-data.vercel.app/api/v3/roomassign/mariadb-summary');
                  
                  const contentType = res.headers.get('content-type');
                  if (!contentType || !contentType.includes('application/json')) {
                    const text = await res.text();
                    console.error("Backend API 비정상 응답 (HTML 등):", text);
                    throw new Error(`API 응답이 올바르지 않습니다. 백엔드 서버 상태를 확인해주세요. (응답: ${text.substring(0, 100)}...)`);
                  }
                  
                  const json = await res.json();
                  
                  let reservationsData = [];
                  let roomsData = [];

                  if (res.ok && json.success) {
                    reservationsData = json.data.reservations;
                    roomsData = json.data.rooms;
                  } else {
                    throw new Error(`MariaDB 연동 실패: ${json.message || 'API 오류'}`);
                  }
                  
                  // 바로 DB에 밀어넣지 않고, 사용자가 확인할 수 있도록 미리보기 상태에 저장합니다.
                  setPreviewData({ reservations: reservationsData, rooms: roomsData });
                } catch (e) {
                  console.error(e);
                  alert("동기화 중 오류가 발생했습니다: " + e.message);
                }
                setIsSettingDB(false);
              }}
              disabled={isSettingDB}
            >
              {isSettingDB ? '⏳ 동기화 중...' : '🔄 마리아DB 최신 데이터 동기화'}
            </button>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>MariaDB 요약 테이블을 읽어와 파이어베이스 현황판에 실시간 반영합니다.</span>
          </div>

          <div style={{ width: '32px', textAlign: 'center', color: '#94a3b8', fontSize: '1.2rem', paddingBottom: '0.5rem', paddingTop: '0.5rem' }}>↓</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', fontSize: '1rem', fontWeight: 'bold', color: 'var(--text-main)' }}>{(rooms.length === 0 || isAdmin) ? '3' : '2'}</div>
            <button 
              className="btn" 
              style={{ width: '220px', justifyContent: 'center', border: '1px solid var(--accent-indigo)', color: 'var(--accent-indigo)' }}
              onClick={() => setIsRulesModalOpen(true)}
            >
              ⚙️ 특별 배정 규칙
            </button>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>"어린이는 1층"과 같이 스마트 배정 시스템에 강제 적용할 규칙을 설정합니다.</span>
          </div>

          {isAdmin && (
            <>
              <div style={{ width: '32px', textAlign: 'center', color: '#94a3b8', fontSize: '1.2rem', paddingBottom: '0.5rem', paddingTop: '0.5rem' }}>↓</div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', fontSize: '1rem', fontWeight: 'bold', color: 'var(--text-main)' }}>4</div>
                <button 
                  onClick={() => handleAutoAssign(false)} 
                  disabled={isAssigning}
                  className="btn btn-gradient"
                  style={{ width: '220px', justifyContent: 'center' }}
                >
                  {isAssigning ? '✨ 배정 중...' : '✨ 스마트 배정 실행'}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>고객 메모와 특별 규칙을 분석하여 최적의 객실을 배정합니다.</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'white', fontWeight: 'bold', marginLeft: '1rem', background: 'rgba(255,255,255,0.05)', padding: '0.25rem 0.75rem', borderRadius: '20px' }}>
                    <input 
                      type="checkbox" 
                      checked={isAutoAssignEnabled} 
                      onChange={toggleAutoAssign} 
                      style={{ width: '16px', height: '16px', accentColor: '#6366f1' }}
                    />
                    자동 배정 {isAutoAssignEnabled ? 'ON' : 'OFF'}
                  </label>
                </div>
              </div>

              <div style={{ width: '32px', textAlign: 'center', color: '#94a3b8', fontSize: '1.2rem', paddingBottom: '0.5rem', paddingTop: '0.5rem' }}>↓</div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', fontSize: '1rem', fontWeight: 'bold', color: 'var(--text-main)' }}>5</div>
                <button 
                  onClick={exportToExcel}
                  className="btn btn-primary"
                  style={{ width: '220px', justifyContent: 'center' }}
                >
                  📊 결과 엑셀 다운로드
                </button>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>최종 확정된 객실 배정 결과를 엑셀 파일로 출력합니다.</span>
              </div>
            </>
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
               room.status === 'assigned' ? '배정됨' : 
               room.status === 'occupied' ? '연박중' :
               room.status === 'checkout' ? '당일퇴실' :
               room.status === 'ooo' ? '점검중' : '차단됨'}
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
      
      {/* Sync Preview Modal */}
      {previewData && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '800px', width: '90%', maxHeight: '80vh', overflowY: 'auto' }}>
            <h3 className="modal-title" style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>
              📋 마리아DB 데이터 동기화 미리보기
            </h3>
            <p className="modal-subtitle" style={{ marginBottom: '1.5rem', lineHeight: '1.5' }}>
              MariaDB에서 읽어온 오늘 체크인 대상자 명단입니다.
            </p>
            
            <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem' }}>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', color: 'var(--text-main)' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.5rem' }}>예약자명</th>
                    <th style={{ padding: '0.5rem' }}>선택 평형</th>
                    <th style={{ padding: '0.5rem' }}>예약/회원 정보</th>
                    <th style={{ padding: '0.5rem' }}>요청 메모</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.reservations.map(res => (
                    <tr key={res.reservationId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 'bold' }}>{res.customerName}</td>
                      <td style={{ padding: '0.75rem 0.5rem' }}>
                        <span style={{ background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', padding: '2px 8px', borderRadius: '4px', fontSize: '0.85rem' }}>
                          {res.roomType}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.9rem' }}>
                        {Boolean(res.is_member) || res.is_member === 1 ? (
                          <span style={{ display: 'inline-block', marginRight: '6px', color: '#FCD34D', fontWeight: 'bold' }}>👑 회원</span>
                        ) : (
                          <span style={{ display: 'inline-block', marginRight: '6px', color: '#9CA3AF' }}>👤 비회원</span>
                        )}
                        {Boolean(res.has_golf) || res.has_golf === 1 ? (
                          <span style={{ display: 'inline-block', color: '#34D399', fontWeight: 'bold' }}>⛳ 골프예약</span>
                        ) : (
                          <span style={{ display: 'inline-block', color: '#9CA3AF' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.9rem', color: '#E5E7EB' }}>{res.notes || '-'}</td>
                    </tr>
                  ))}
                  {previewData.reservations.length === 0 && (
                    <tr>
                      <td colSpan="4" style={{ padding: '1rem', textAlign: 'center', color: '#9CA3AF' }}>예약 데이터가 없습니다.</td>
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
