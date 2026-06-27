import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, doc, writeBatch, onSnapshot } from 'firebase/firestore';
import roomsData from '../data/roomsData.json';

function RoomInventory({ isAdmin }) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('101');
  const [isInitializing, setIsInitializing] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [notesInput, setNotesInput] = useState('');

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'rooms'), (snapshot) => {
      const roomsArray = snapshot.docs.map(doc => doc.data());
      setRooms(roomsArray);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

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
      <div className="inventory-header">
        <h2 className="text-2xl font-bold text-white">객실 인벤토리 현황판</h2>
        {(rooms.length === 0 || isAdmin) && (
          <button 
            onClick={initializeRooms} 
            disabled={isInitializing}
            className="btn btn-primary"
            style={{ backgroundColor: rooms.length > 0 ? 'var(--error-color)' : undefined }}
          >
            {isInitializing ? '초기화 중...' : '데이터 (강제) 재초기화'}
          </button>
        )}
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
      
    </div>
  );
}

export default RoomInventory;
