import { useState } from 'react';
import { auth } from '../firebase';
import { signInAnonymously, updateProfile, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';

function Login() {
  const [activeTab, setActiveTab] = useState('name'); // 'name' or 'email'
  
  // Name Login State
  const [name, setName] = useState('');

  // Email Login State
  const [emailName, setEmailName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  const handleNameLogin = async (e) => {
    e.preventDefault();
    if (!name.trim()) return alert('이름을 입력해주세요.');
    
    try {
      const userCredential = await signInAnonymously(auth);
      await updateProfile(userCredential.user, { displayName: name.trim() });
    } catch (error) {
      console.error('Anonymous Login failed:', error);
      alert('로그인에 실패했습니다. 다시 시도해주세요.');
    }
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    try {
      if (isRegistering) {
        if (!emailName.trim()) return alert('본인의 이름을 입력해주세요.');
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: emailName.trim() });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      console.error('Email Auth failed:', error);
      if (error.code === 'auth/email-already-in-use') {
        alert('이미 가입된 이메일입니다. "로그인하기"로 전환하여 접속해주세요.');
      } else if (error.code === 'auth/weak-password') {
        alert('비밀번호는 최소 6자리 이상이어야 합니다.');
      } else {
        alert('이메일 또는 비밀번호가 올바르지 않습니다.');
      }
    }
  };

  return (
    <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '400px', textAlign: 'center', padding: '2rem' }}>
        <h1 style={{ marginBottom: '0.5rem', fontSize: '1.5rem', fontWeight: '600' }}>
          Belle Foret Resort
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.9rem' }}>
          관리자 및 직원 전용 시스템입니다.
        </p>

        {/* Tabs */}
        <div style={{ display: 'flex', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <button 
            onClick={() => setActiveTab('name')}
            style={{ 
              flex: 1, 
              padding: '0.8rem', 
              background: 'none', 
              border: 'none', 
              borderBottom: activeTab === 'name' ? '2px solid var(--primary-color)' : '2px solid transparent',
              color: activeTab === 'name' ? 'var(--text-bright)' : 'var(--text-muted)',
              fontWeight: activeTab === 'name' ? '600' : '400',
              cursor: 'pointer'
            }}
          >
            임시 간편 접속
          </button>
          <button 
            onClick={() => setActiveTab('email')}
            style={{ 
              flex: 1, 
              padding: '0.8rem', 
              background: 'none', 
              border: 'none', 
              borderBottom: activeTab === 'email' ? '2px solid var(--primary-color)' : '2px solid transparent',
              color: activeTab === 'email' ? 'var(--text-bright)' : 'var(--text-muted)',
              fontWeight: activeTab === 'email' ? '600' : '400',
              cursor: 'pointer'
            }}
          >
            정식 이메일 가입
          </button>
        </div>

        {activeTab === 'name' ? (
          <form onSubmit={handleNameLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem', textAlign: 'left' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>직원 이름 (실명)</label>
              <input 
                type="text" 
                value={name} 
                onChange={(e) => setName(e.target.value)} 
                className="modal-input" 
                placeholder="홍길동"
                required
                style={{ width: '100%', background: 'var(--bg-dark)' }}
              />
            </div>
            
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
              이름으로 바로 접속하기
            </button>

            <div style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              * 정식 가입 전 임시로 사용 가능한 접속 방식입니다.<br/>
              * 임시 접속자는 활동 기록에 이름이 남게 됩니다.
            </div>
          </form>
        ) : (
          <form onSubmit={handleEmailAuth} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem', textAlign: 'left' }}>
            
            {isRegistering && (
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>이름 (실명)</label>
                <input 
                  type="text" 
                  value={emailName} 
                  onChange={(e) => setEmailName(e.target.value)} 
                  className="modal-input" 
                  placeholder="홍길동"
                  required={isRegistering}
                  style={{ width: '100%', background: 'var(--bg-dark)' }}
                />
              </div>
            )}

            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>회사 이메일</label>
              <input 
                type="email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                className="modal-input" 
                placeholder="example@belleforet.com"
                required
                style={{ width: '100%', background: 'var(--bg-dark)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>비밀번호 (6자리 이상)</label>
              <input 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                className="modal-input" 
                placeholder="••••••••"
                required
                style={{ width: '100%', background: 'var(--bg-dark)' }}
              />
            </div>
            
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
              {isRegistering ? '직원 이메일 가입하기' : '이메일로 로그인'}
            </button>

            <div style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              {isRegistering ? '이미 등록하셨나요? ' : '아직 등록하지 않으셨나요? '}
              <span 
                style={{ color: 'var(--primary-color)', cursor: 'pointer', textDecoration: 'underline' }} 
                onClick={() => setIsRegistering(!isRegistering)}
              >
                {isRegistering ? '로그인하기' : '직원 신규 가입'}
              </span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default Login;
