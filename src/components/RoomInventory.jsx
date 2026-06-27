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
    <div className="space-y-6 relative">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">객실 인벤토리 현황판</h2>
        {(rooms.length === 0 || isAdmin) && (
          <button 
            onClick={initializeRooms} 
            disabled={isInitializing}
            className="btn btn-primary"
            style={{ backgroundColor: rooms.length > 0 ? 'var(--rose-600)' : undefined }}
          >
            {isInitializing ? '초기화 중...' : '데이터 (강제) 재초기화'}
          </button>
        )}
      </div>

      {/* Stats Board */}
      <div className="grid grid-cols-4 gap-4 p-4 rounded-xl border border-white/10 bg-white/5">
        <div className="text-center">
          <div className="text-sm text-gray-400">잔여 16평형</div>
          <div className="text-2xl font-bold text-emerald-400">{stats.available16P}</div>
        </div>
        <div className="text-center">
          <div className="text-sm text-gray-400">잔여 35평형</div>
          <div className="text-2xl font-bold text-emerald-400">{stats.available35P}</div>
        </div>
        <div className="text-center border-l border-white/10">
          <div className="text-sm text-gray-400">온전한 51평 세트 (예약가능)</div>
          <div className="text-2xl font-bold text-indigo-400">{stats.unbroken51PSets}</div>
        </div>
        <div className="text-center border-l border-white/10">
          <div className="text-sm text-gray-400">장애인 전용 51평형</div>
          <div className="text-2xl font-bold text-amber-400">{stats.availableDisabled51P}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 border-b border-white/10 pb-2">
        {['101', '102', '103', '104', '105'].map(building => (
          <button
            key={building}
            onClick={() => setActiveTab(building)}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              activeTab === building 
                ? 'bg-white/20 text-white' 
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {building}동
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {filteredRooms.map(room => (
          <div 
            key={room.id}
            onClick={() => {
              setSelectedRoom(room);
              setNotesInput(room.notes || '');
            }}
            className={`p-4 rounded-xl border backdrop-blur-md flex flex-col items-center justify-center text-center cursor-pointer hover:scale-105 transition-all ${
              room.status === 'available' ? 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20' :
              room.status === 'assigned' ? 'bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/20' :
              'bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20'
            }`}
          >
            <div className="text-xl font-bold text-white mb-1">{room.roomNumber}</div>
            <div className="text-xs text-gray-300 mb-2">{room.size} ({room.bedType})</div>
            
            <div className={`px-2 py-1 rounded text-[10px] font-bold ${
              room.status === 'available' ? 'bg-emerald-500/20 text-emerald-400' :
              room.status === 'assigned' ? 'bg-blue-500/20 text-blue-400' :
              'bg-rose-500/20 text-rose-400'
            }`}>
              {room.status === 'available' ? '빈 방' :
               room.status === 'assigned' ? '배정됨' : '차단됨'}
            </div>
            
            {room.isConnecting && (
              <div className="mt-2 text-[10px] text-indigo-300">
                🔗 커넥팅 ({room.adjacent})
              </div>
            )}
            
            {room.notes && (
              <div className="mt-2 text-[10px] text-gray-400 truncate w-full px-2" title={room.notes}>
                📝 {room.notes}
              </div>
            )}
          </div>
        ))}
      </div>
      
      {/* Control Modal */}
      {selectedRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelectedRoom(null)}>
          <div className="bg-[#1a1c23] border border-white/10 p-6 rounded-2xl max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-white mb-2">
              {selectedRoom.building}동 {selectedRoom.roomNumber}호 관리
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              타입: {selectedRoom.size} ({selectedRoom.bedType}) 
              {selectedRoom.isConnecting && ` / 커넥팅 인접: ${selectedRoom.adjacent}호`}
            </p>
            
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">메모 (고객명 등)</label>
              <input 
                type="text" 
                value={notesInput}
                onChange={e => setNotesInput(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-white"
                placeholder="예: 홍길동 고객님"
              />
            </div>
            
            <div className="flex flex-col gap-2">
              <button onClick={() => handleUpdateStatus('available')} className="p-2 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                ✅ 빈 방으로 전환 (예약 취소)
              </button>
              
              <button onClick={() => handleUpdateStatus('assigned', false)} className="p-2 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30">
                🟦 개별 객실로 배정 ({selectedRoom.size}만 배정)
              </button>

              {selectedRoom.isConnecting && (
                <button onClick={() => handleUpdateStatus('assigned', true)} className="p-2 rounded bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 border border-indigo-500/30">
                  🟪 51평 통합 배정 ({selectedRoom.roomNumber} + {selectedRoom.adjacent} 동시 배정)
                </button>
              )}
              
              <button onClick={() => handleUpdateStatus('blocked')} className="p-2 rounded bg-rose-500/20 text-rose-400 hover:bg-rose-500/30">
                🚫 객실 차단 (수리 등)
              </button>
            </div>
            
            <button onClick={() => setSelectedRoom(null)} className="mt-6 w-full p-2 rounded bg-white/5 text-white hover:bg-white/10">
              닫기
            </button>
          </div>
        </div>
      )}
      
    </div>
  );
}

export default RoomInventory;
