import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';

export default function CustomRulesModal({ isOpen, onClose }) {
  const [rules, setRules] = useState([]);
  const [newRule, setNewRule] = useState('');
  const [isOneTime, setIsOneTime] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchRules();
    }
  }, [isOpen]);

  const fetchRules = async () => {
    try {
      const q = query(collection(db, 'ai_rules'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const fetchedRules = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setRules(fetchedRules);
    } catch (error) {
      console.error('규칙을 불러오는데 실패했습니다.', error);
    }
  };

  const handleAddRule = async () => {
    if (!newRule.trim()) return;
    
    setIsLoading(true);
    try {
      const ruleData = {
        text: newRule,
        isActive: true,
        isOneTime: isOneTime,
        createdAt: serverTimestamp()
      };
      
      const docRef = await addDoc(collection(db, 'ai_rules'), ruleData);
      setRules([{ id: docRef.id, ...ruleData, createdAt: new Date() }, ...rules]);
      setNewRule('');
    } catch (error) {
      console.error('규칙 추가 실패:', error);
      alert('규칙 저장 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRuleActive = async (id, currentStatus) => {
    try {
      const ruleRef = doc(db, 'ai_rules', id);
      await updateDoc(ruleRef, { isActive: !currentStatus });
      setRules(rules.map(r => r.id === id ? { ...r, isActive: !currentStatus } : r));
    } catch (error) {
      console.error('상태 변경 실패:', error);
    }
  };

  const deleteRule = async (id) => {
    if (!window.confirm('이 특수 규칙을 삭제하시겠습니까?')) return;
    try {
      await deleteDoc(doc(db, 'ai_rules', id));
      setRules(rules.filter(r => r.id !== id));
    } catch (error) {
      console.error('삭제 실패:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '600px' }}>
        <h2 className="modal-title">⚙️ 특별 배정 규칙</h2>
        <p className="modal-subtitle" style={{ marginBottom: '1.5rem' }}>
          자연어로 지시사항을 입력하면 시스템이 이를 해석하여 배정 로직에 강제로 반영합니다.<br/>
          (예: "하나은행 워크샵 고객들은 모두 103동 16평으로 배정해")
        </p>

        <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
          <textarea
            className="input-field"
            rows="3"
            placeholder="시스템에 내릴 자연어 지시사항을 입력하세요..."
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
                style={{ width: '1rem', height: '1rem' }}
              />
              <span style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>이번 1회만 단발성으로 적용</span>
            </label>
            <button 
              className="btn btn-gradient"
              onClick={handleAddRule}
              disabled={isLoading || !newRule.trim()}
            >
              규칙 추가
            </button>
          </div>
        </div>

        <h3 className="heading-text" style={{ fontSize: '1.2rem', marginBottom: '1rem', color: 'var(--primary-color)' }}>
          적용 중인 규칙 목록
        </h3>
        
        <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
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
                    {!rule.isOneTime && <span className="room-status-badge" style={{ color: '#6EE7B7', background: 'rgba(110, 231, 183, 0.1)', border: '1px solid rgba(110, 231, 183, 0.2)' }}>계속 유지</span>}
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

        <button className="modal-btn close" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
