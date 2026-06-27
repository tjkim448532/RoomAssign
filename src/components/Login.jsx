import { auth } from '../firebase';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';

function Login() {
  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed:', error);
      alert('로그인에 실패했습니다. 다시 시도해주세요.');
    }
  };

  return (
    <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '400px', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1rem', fontSize: '1.5rem', fontWeight: '600' }}>
          Belle Foret Resort
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
          관리자 및 직원 전용 시스템입니다.
        </p>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleGoogleLogin}>
          Google 계정으로 로그인
        </button>
      </div>
    </div>
  );
}

export default Login;
