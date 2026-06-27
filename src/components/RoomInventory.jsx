import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, getDocs, doc, writeBatch, onSnapshot } from 'firebase/firestore';
import roomsData from '../data/roomsData.json';

function RoomInventory() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('101');
  const [isInitializing, setIsInitializing] = useState(false);

  useEffect(() => {
    // Real-time listener for rooms
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
        if (!row['동'] || !row['호수']) return;
        
        const building = row['동'].replace('동', '');
        const roomNumber = row['호수'];
        const id = `${building}-${roomNumber}`;
        const bedType = row['침대타입(코드)'];
        const adjacent = row['인접호수'] || null;
        const combined = row['결합시평형'] === '51평';
        
        const roomRef = doc(db, 'rooms', id);
        batch.set(roomRef, {
          id,
          building,
          roomNumber,
          bedType,
          adjacent,
          isConnecting: combined,
          status: 'available', // available, assigned, blocked
          notes: row['특이사항'] || '',
          noiseWarning: row['소음주의여부'] || ''
        });
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

  if (loading) {
    return <div className="p-8 text-center text-gray-400">객실 데이터를 불러오는 중...</div>;
  }

  // Filter rooms by active building tab
  const filteredRooms = rooms.filter(r => r.building === activeTab).sort((a, b) => parseInt(a.roomNumber) - parseInt(b.roomNumber));
  
  // Group connecting rooms logic: we just show them side by side or clearly marked
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">객실 인벤토리 현황판</h2>
        
        {rooms.length === 0 && (
          <button 
            onClick={initializeRooms} 
            disabled={isInitializing}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all font-medium disabled:opacity-50"
          >
            {isInitializing ? '초기화 중...' : '객실 데이터 초기화 (1회 필요)'}
          </button>
        )}
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
            className={`p-4 rounded-xl border backdrop-blur-md flex flex-col items-center justify-center text-center transition-all ${
              room.status === 'available' ? 'bg-emerald-500/10 border-emerald-500/30' :
              room.status === 'assigned' ? 'bg-blue-500/10 border-blue-500/30' :
              'bg-rose-500/10 border-rose-500/30'
            }`}
          >
            <div className="text-xl font-bold text-white mb-1">{room.roomNumber}</div>
            <div className="text-xs text-gray-300 mb-2">{room.bedType}</div>
            
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
            
            {room.noiseWarning && (
              <div className="mt-1 text-[10px] text-amber-400" title={room.noiseWarning}>
                ⚠️ 소음
              </div>
            )}
          </div>
        ))}
      </div>
      
      {filteredRooms.length === 0 && rooms.length > 0 && (
        <div className="text-center py-10 text-gray-400">
          해당 동에 객실 데이터가 없습니다.
        </div>
      )}
    </div>
  );
}

export default RoomInventory;
