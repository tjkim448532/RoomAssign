import { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import RoomInventory from './RoomInventory';

function Dashboard({ user, role }) {
  const [records, setRecords] = useState([]);
  const [users, setUsers] = useState([]);
  const [newRecord, setNewRecord] = useState('');
  const [currentTab, setCurrentTab] = useState('inventory'); // 'inventory', 'records'

  const isAdmin = role === 'admin';

  useEffect(() => {
    // Fetch records
    const qRecords = query(collection(db, 'records'), orderBy('createdAt', 'desc'));
    const unsubRecords = onSnapshot(qRecords, (snapshot) => {
      setRecords(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    let unsubUsers;
    if (isAdmin) {
      // Fetch users for admin
      const qUsers = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
      unsubUsers = onSnapshot(qUsers, (snapshot) => {
        setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
    }

    return () => {
      unsubRecords();
      if (unsubUsers) unsubUsers();
    };
  }, [isAdmin]);

  const handleLogout = () => {
    signOut(auth);
  };

  const handleAddRecord = async (e) => {
    e.preventDefault();
    if (!newRecord.trim()) return;
    try {
      await addDoc(collection(db, 'records'), {
        text: newRecord,
        author: user.displayName,
        authorId: user.uid,
        createdAt: serverTimestamp()
      });
      setNewRecord('');
    } catch (error) {
      console.error("Error adding record: ", error);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, { role: newRole });
    } catch (error) {
      console.error("Error updating role: ", error);
    }
  };

  return (
    <div className="container animate-fade-in">
      <header className="header">
        <h1>벨포레 리조트 관리 시스템</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span className={`badge ${isAdmin ? 'badge-admin' : 'badge-user'}`}>
            {isAdmin ? 'Admin' : 'User'}
          </span>
          <span>{user.displayName}</span>
          <button className="btn btn-danger" onClick={handleLogout} style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            로그아웃
          </button>
        </div>
      </header>

      {/* Main Navigation Tabs */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
        <button 
          onClick={() => setCurrentTab('inventory')}
          style={{ padding: '0.5rem 1rem', background: currentTab === 'inventory' ? 'var(--primary-color)' : 'transparent', color: 'white', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
        >
          객실 현황판
        </button>
        <button 
          onClick={() => setCurrentTab('records')}
          style={{ padding: '0.5rem 1rem', background: currentTab === 'records' ? 'var(--primary-color)' : 'transparent', color: 'white', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
        >
          업무 일지 및 관리
        </button>
      </div>

      {currentTab === 'inventory' && (
        <div className="glass-card">
          <RoomInventory />
        </div>
      )}

      {currentTab === 'records' && (
        <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '2fr 1fr' : '1fr', gap: '2rem' }}>
          
          {/* Records Section */}
          <section>
            <div className="glass-card" style={{ marginBottom: '2rem' }}>
              <h2 style={{ marginBottom: '1rem' }}>업무 일지 기록</h2>
              <form onSubmit={handleAddRecord} style={{ display: 'flex', gap: '1rem' }}>
                <input
                  type="text"
                  className="input-field"
                  placeholder="오늘의 특이사항이나 배정 기록을 남겨주세요..."
                  value={newRecord}
                  onChange={(e) => setNewRecord(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
                  기록 추가
                </button>
              </form>
            </div>

            <div className="glass-card">
              <h2 style={{ marginBottom: '1.5rem' }}>지난날 기록</h2>
              {records.map(record => (
                <div key={record.id} className="record-item">
                  <div className="record-meta">
                    <span style={{ fontWeight: '600', color: 'var(--text-main)' }}>{record.author}</span>
                    <span>{record.createdAt?.toDate().toLocaleString()}</span>
                  </div>
                  <div className="record-content">
                    {record.text}
                  </div>
                </div>
              ))}
              {records.length === 0 && <p style={{ color: 'var(--text-muted)' }}>기록이 없습니다.</p>}
            </div>
          </section>

          {/* Admin Section */}
          {isAdmin && (
            <section>
              <div className="glass-card">
                <h2 style={{ marginBottom: '1.5rem' }}>사용자 권한 관리</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {users.map(u => (
                    <div key={u.id} className="record-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem' }}>
                      <div>
                        <div style={{ fontWeight: '500' }}>{u.displayName}</div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{u.email}</div>
                      </div>
                      <select 
                        value={u.role || 'user'} 
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        style={{
                          padding: '0.5rem',
                          borderRadius: '6px',
                          background: 'var(--bg-dark)',
                          color: 'var(--text-main)',
                          border: '1px solid var(--border-color)',
                          outline: 'none'
                        }}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export default Dashboard;
