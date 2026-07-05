import { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import RoomInventory from './RoomInventory';

function Dashboard({ user, role }) {
  const [records, setRecords] = useState([]);
  const [users, setUsers] = useState([]);
  const [newRecord, setNewRecord] = useState('');
  const [currentTab, setCurrentTab] = useState('inventory'); // 'inventory', 'records'

  // AI Rules State
  const [rules, setRules] = useState([]);
  const [newRule, setNewRule] = useState('');
  const [isOneTime, setIsOneTime] = useState(false);
  const [isRuleLoading, setIsRuleLoading] = useState(false);

  const isAdmin = role === 'admin';

  useEffect(() => {
    // Fetch records
    const qRecords = query(collection(db, 'records'), orderBy('createdAt', 'desc'));
    const unsubRecords = onSnapshot(qRecords, (snapshot) => {
      setRecords(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    let unsubUsers;
    let unsubRules;
    if (isAdmin) {
      // Fetch users for admin
      const qUsers = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
      unsubUsers = onSnapshot(qUsers, (snapshot) => {
        setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
      
      // Fetch AI rules for admin
      const qRules = query(collection(db, 'ai_rules'), orderBy('createdAt', 'desc'));
      unsubRules = onSnapshot(qRules, (snapshot) => {
        setRules(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
    }

    return () => {
      unsubRecords();
      if (unsubUsers) unsubUsers();
      if (unsubRules) unsubRules();
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

  const handleDeleteRecord = async (recordId, authorId) => {
    // 본인이 작성한 글이거나 관리자만 삭제 가능
    if (user.uid !== authorId && !isAdmin) {
      alert("자신이 작성한 기록만 삭제할 수 있습니다.");
      return;
    }
    if (!window.confirm("정말 이 기록을 삭제하시겠습니까?")) return;
    
    try {
      await deleteDoc(doc(db, 'records', recordId));
    } catch (error) {
      console.error("Error deleting record: ", error);
      alert("삭제 중 오류가 발생했습니다.");
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

  const handleAddRule = async () => {
    if (!newRule.trim()) return;
    setIsRuleLoading(true);
    try {
      await addDoc(collection(db, 'ai_rules'), {
        text: newRule,
        isActive: true,
        isOneTime: isOneTime,
        createdAt: serverTimestamp()
      });
      setNewRule('');
    } catch (error) {
      console.error('규칙 추가 실패:', error);
      alert('규칙 저장 중 오류가 발생했습니다.');
    } finally {
      setIsRuleLoading(false);
    }
  };

  const toggleRuleActive = async (id, currentStatus) => {
    try {
      const ruleRef = doc(db, 'ai_rules', id);
      await updateDoc(ruleRef, { isActive: !currentStatus });
    } catch (error) {
      console.error('상태 변경 실패:', error);
    }
  };

  const deleteRule = async (id) => {
    if (!window.confirm('이 특수 규칙을 삭제하시겠습니까?')) return;
    try {
      await deleteDoc(doc(db, 'ai_rules', id));
    } catch (error) {
      console.error('삭제 실패:', error);
    }
  };

  return (
    <div className="container">
      <aside className="app-sidebar">
        <div className="sidebar-header">
          🏨 객실 배정 시스템
        </div>
        <div className="sidebar-menu">
          <div 
            className={`sidebar-item ${currentTab === 'inventory' ? 'active' : ''}`}
            onClick={() => setCurrentTab('inventory')}
          >
            📊 객실 현황판
          </div>
          <div 
            className={`sidebar-item ${currentTab === 'records' ? 'active' : ''}`}
            onClick={() => setCurrentTab('records')}
          >
            📝 업무 일지 및 관리
          </div>
        </div>

        {/* Sidebar Mascot Decoration */}
        <div style={{ padding: '16px', display: 'flex', justifyContent: 'center' }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(162, 140, 237, 0.1) 0%, rgba(244, 114, 182, 0.15) 100%)',
            borderRadius: '16px',
            padding: '16px 12px',
            border: '1px solid rgba(244, 114, 182, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            position: 'relative',
            overflow: 'hidden',
            width: '100%'
          }}>
            {/* Sparkles */}
            <div style={{ position: 'absolute', top: '15px', left: '15px', color: '#f472b6', fontSize: '12px', opacity: 0.8 }}>✨</div>
            <div style={{ position: 'absolute', top: '45px', right: '15px', color: '#c084fc', fontSize: '14px', opacity: 0.7 }}>✦</div>
            <div style={{ position: 'absolute', bottom: '70px', left: '20px', color: '#fbbf24', fontSize: '10px', opacity: 0.9 }}>⭐</div>
            
            <img src="/receptionist.png" alt="Mascot" style={{ width: '110px', height: '110px', objectFit: 'cover', borderRadius: '50%', border: '3px solid #ffffff', boxShadow: '0 4px 12px rgba(162, 140, 237, 0.2)', marginBottom: '12px', background: '#ffffff' }} />
            
            <div style={{ background: '#ffffff', borderRadius: '12px', padding: '10px', fontSize: '12.5px', color: 'var(--text-main)', fontWeight: '600', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', position: 'relative', textAlign: 'center', lineHeight: '1.4', width: '100%' }}>
              <div style={{ position: 'absolute', top: '-6px', left: '50%', transform: 'translateX(-50%)', width: '0', height: '0', borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: '6px solid #ffffff' }}></div>
              <span style={{ color: '#db2777' }}>오늘도 화이팅! 💖</span><br/>
              <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: '500' }}>완벽한 배정을 응원해요!</span>
            </div>
          </div>
        </div>
        <div className="sidebar-header" style={{ borderTop: '1px solid var(--border-color)', borderBottom: 'none', justifyContent: 'space-between', flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <span style={{ fontSize: '11px', color: isAdmin ? 'var(--primary-color)' : 'var(--text-muted)', fontWeight: 'bold' }}>[{isAdmin ? 'Admin' : 'User'}] </span>
            {user.displayName}
          </div>
          <button className="btn" onClick={handleLogout} style={{ width: '100%', textAlign: 'center' }}>
            로그아웃
          </button>
        </div>
      </aside>

      <main className="main-content">
        {currentTab === 'inventory' && (
          <RoomInventory isAdmin={isAdmin} />
        )}

        {currentTab === 'records' && (
          <div style={{ padding: '20px', overflowY: 'auto', height: '100%' }}>
            <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '2fr 1fr' : '1fr', gap: '20px' }}>
          
          {/* Records Section */}
          <section>
            <div className="glass-panel" style={{ marginBottom: '2rem' }}>
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

            <div className="glass-panel">
              <h2 style={{ marginBottom: '1.5rem' }}>지난날 기록</h2>
              {records.map(record => (
                <div key={record.id} className="record-item">
                  <div className="record-meta" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div>
                      <span style={{ fontWeight: '600', color: 'var(--text-main)', marginRight: '10px' }}>{record.author}</span>
                      <span>{record.createdAt?.toDate().toLocaleString()}</span>
                    </div>
                    {(user.uid === record.authorId || isAdmin) && (
                      <button 
                        onClick={() => handleDeleteRecord(record.id, record.authorId)}
                        style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem', padding: '0 5px' }}
                        title="삭제"
                      >
                        🗑️
                      </button>
                    )}
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
            <section style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              <div className="glass-panel">
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

              {/* AI Rule Management */}
              <div className="glass-panel">
                <h2 style={{ marginBottom: '1.5rem' }}>AI 특별 배정 규칙 관리</h2>
                
                <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
                  <textarea
                    className="input-field"
                    rows="3"
                    placeholder="시스템에 내릴 자연어 지시사항을 입력하세요... (예: 하나은행 워크샵 고객들은 103동으로 배정해)"
                    value={newRule}
                    onChange={(e) => setNewRule(e.target.value)}
                    style={{ resize: 'none', marginBottom: '1rem' }}
                  ></textarea>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={isOneTime}
                        onChange={(e) => setIsOneTime(e.target.checked)}
                        style={{ width: '1rem', height: '1rem', accentColor: 'var(--accent-indigo)' }}
                      />
                      <span style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>이번 1회만 단발성으로 적용</span>
                    </label>
                    <button 
                      className="btn btn-gradient"
                      onClick={handleAddRule}
                      disabled={isRuleLoading || !newRule.trim()}
                    >
                      규칙 추가
                    </button>
                  </div>
                </div>

                <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {rules.length === 0 ? (
                    <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>등록된 특수 규칙이 없습니다.</p>
                  ) : (
                    rules.map(rule => (
                      <div key={rule.id} style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: `1px solid ${rule.isActive ? 'var(--accent-indigo)' : 'var(--border-color)'}`,
                        padding: '1rem',
                        borderRadius: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '1rem',
                        opacity: rule.isActive ? 1 : 0.5
                      }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: '0.95rem', lineHeight: '1.4', marginBottom: '0.5rem' }}>{rule.text}</p>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            {rule.isOneTime && <span className="room-status-badge" style={{ color: '#FCD34D', background: 'rgba(252, 211, 77, 0.1)', border: '1px solid rgba(252, 211, 77, 0.2)' }}>단발성</span>}
                            {!rule.isOneTime && <span className="room-status-badge" style={{ color: '#6EE7B7', background: 'rgba(110, 231, 183, 0.1)', border: '1px solid rgba(110, 231, 183, 0.2)' }}>항시 유지</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <button 
                            onClick={() => toggleRuleActive(rule.id, rule.isActive)}
                            style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-main)', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                          >
                            {rule.isActive ? '끄기 (OFF)' : '켜기 (ON)'}
                          </button>
                          <button 
                            onClick={() => deleteRule(rule.id)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--error-color)', cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'underline' }}
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default Dashboard;
