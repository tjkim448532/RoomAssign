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
  const [featuresInput, setFeaturesInput] = useState([]);

  const [hasAutoAssigned, setHasAutoAssigned] = useState(false);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [activeRules, setActiveRules] = useState([]);
  const [isSettingDB, setIsSettingDB] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [targetDate, setTargetDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedForGroup, setSelectedForGroup] = useState([]);
  
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
    
    let finalNotes = notesInput;

    if (status === 'blocked' && selectedRoom.status === 'assigned') {
      const confirmKick = window.confirm(`현재 이 방에 배정된 고객이 있습니다.\n\n이 고객의 방 배정을 취소하고 다른 방으로 자동 재배정 받도록 대기열로 돌려보내시겠습니까?\n\n[확인] 배정 취소 후 객실 차단\n[취소] 고객은 그대로 두고 객실만 차단`);
      if (confirmKick) {
        finalNotes = '차단됨 (점검/수리)';
        setNotesInput(finalNotes);
      } else {
        finalNotes = notesInput || selectedRoom.notes;
      }
    } else if (status === 'available') {
      finalNotes = '';
      setNotesInput('');
    } else {
      finalNotes = notesInput || selectedRoom.notes;
    }
    
    try {
      const batch = writeBatch(db);
      const roomRef = doc(db, 'rooms', selectedRoom.id);
      
      batch.update(roomRef, { 
        status, 
        notes: finalNotes
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
    
    // 선택된 예약건 찾기
    const selectedRes = previewData.reservations.filter(r => selectedForGroup.includes(r.reservationId));
    if (selectedRes.length === 0) return;
    
    // 대표자 이름 및 텍스트 생성
    let repName = selectedRes[0].groupName || selectedRes[0].agencyName;
    if (!repName) {
      const extracted = selectedRes[0].customerName?.replace(/\(.*?\)/g, '').trim();
      repName = extracted || selectedRes[0].customerName;
    }
    const inputGroupName = window.prompt("지정할 단체명(일행명)을 입력하세요:", repName);
    if (inputGroupName === null) return; // 취소
    const finalGroupName = inputGroupName.trim() || repName;
    const groupText = `[일행: ${finalGroupName} 외 ${selectedRes.length - 1}명]`;
    
    setPreviewData(prev => ({
      ...prev,
      reservations: prev.reservations.map(r => {
        if (selectedForGroup.includes(r.reservationId)) {
          const currentNotes = r.notes || '';
          // 이미 일행 태그가 있다면 중복 방지
          const newNotes = currentNotes.includes(groupText) ? currentNotes : (currentNotes ? `${currentNotes} ${groupText}` : groupText);
          return { ...r, notes: newNotes, groupName: finalGroupName };
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
        <h1 className="header-title" style={{ fontSize: '18px', margin: 0 }}>📊 객실 현황판</h1>
        
        {/* Action Toolbar */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {(rooms.length === 0 || isAdmin) && (
            <button 
              onClick={initializeRooms} 
              disabled={isInitializing}
              className="btn btn-primary"
            >
              {isInitializing ? '⏳ 초기화 중...' : '1. 객실 초기화'}
            </button>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input 
              type="date" 
              value={targetDate} 
              onChange={(e) => setTargetDate(e.target.value)} 
              onKeyDown={(e) => e.preventDefault()}
              onClick={(e) => e.target.showPicker && e.target.showPicker()}
              className="input-field"
              style={{ width: '130px', padding: '4px 8px', height: '27px' }}
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
                          groupName: info.groupName,
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
              2. {isSettingDB ? '⏳ 데이터 불러오는 중...' : '예약 동기화'}
            </button>
          </div>

          <button 
            className="btn" 
            onClick={() => setIsRulesModalOpen(true)}
          >
            3. 특별 규칙
          </button>

          {isAdmin && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--bg-hover)', padding: '4px 8px', borderRadius: '4px', height: '27px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-bright)' }}>
                  <input 
                    type="checkbox" 
                    checked={isAutoAssignEnabled} 
                    onChange={toggleAutoAssign} 
                    style={{ margin: 0 }}
                  />
                  자동 배정 {isAutoAssignEnabled ? 'ON' : 'OFF'}
                </label>
              </div>

              <button 
                onClick={() => handleAutoAssign(false)} 
                disabled={isAssigning}
                className="btn btn-gradient"
              >
                4. {isAssigning ? '✨ 배정 중...' : '✨ 스마트 배정'}
              </button>

              <button 
                onClick={exportToExcel}
                className="btn"
              >
                5. 엑셀 다운로드
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats Ribbon */}
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
      <div className="room-grid-wrapper">
        <div className="room-grid">
          {filteredRooms.map(room => (
            <div 
              key={room.id}
              onClick={() => {
                setSelectedRoom(room);
                setNotesInput(room.notes || '');
                setFeaturesInput(room.features || []);
              }}
              className={`room-card ${room.status}`}
            >
              <div className="room-number">{room.roomNumber}</div>
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
              
              {room.notes && (
                <div className="room-notes" title={room.notes}>
                  {room.notes}
                </div>
              )}
            </div>
          ))}
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
        <div className="modal-overlay" style={{ alignItems: 'flex-start', paddingTop: '5vh' }}>
          <div className="modal-content" style={{ maxWidth: '1000px', width: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 className="modal-title" style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>
              📋 PMS 예약 데이터 동기화 미리보기
            </h3>
            <p className="modal-subtitle" style={{ marginBottom: '1.5rem', lineHeight: '1.5', color: '#fbbf24' }}>
              ⚠️ 본 리스트는 <strong>오늘 아침 기준의 PMS 예약 데이터</strong>입니다. 실시간 연동이 아니므로 오늘 아침 이후에 추가된 당일 예약 등은 누락되어 있을 수 있습니다. 직원용 비교 대조를 위해 창이 고정 유지됩니다.
            </p>

            {/* Subtotal Area */}
            {previewStats && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem', padding: '1rem', background: 'rgba(52, 211, 153, 0.1)', borderRadius: '8px', border: '1px solid rgba(52, 211, 153, 0.3)' }}>
                <span style={{ fontWeight: 'bold', color: 'white' }}>총 대기 고객: {previewStats.total}명</span>
                <span style={{ color: '#9CA3AF' }}>|</span>
                {Object.entries(previewStats.rooms).sort((a,b)=>a[0].localeCompare(b[0])).map(([type, count]) => (
                  <span key={type} style={{ color: '#E5E7EB' }}>{type}: <span style={{ color: '#34D399', fontWeight: 'bold' }}>{count}</span>개</span>
                ))}
              </div>
            )}
            
            <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', minHeight: '36px' }}>
                <span style={{ color: '#9CA3AF', fontSize: '0.9rem' }}>
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
                    <tr key={res.reservationId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: selectedForGroup.includes(res.reservationId) ? 'rgba(79, 70, 229, 0.15)' : 'transparent', transition: 'background 0.2s' }}>
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
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 'bold' }}>
                        <span style={{ color: '#6B7280', marginRight: '8px', fontSize: '0.85rem' }}>{index + 1}</span>
                        {res.groupName || res.agencyName ? (
                          <>
                            <span style={{ color: '#F87171' }}>{res.groupName || res.agencyName}</span>
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
