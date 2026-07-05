import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, db } from './firebase';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs } from 'firebase/firestore';

import Login from './components/Login';
import Dashboard from './components/Dashboard';
import { triggerMagicEffect } from './utils/magicEffect';

function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [isApproved, setIsApproved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Global Magic Click Effect Listener
    const handleGlobalClick = (e) => {
      try {
        if (!e.target || typeof e.target.closest !== 'function') return;
        const target = e.target.closest('button, .tab-btn, .room-card, .btn, .sidebar-item');
        if (target) {
          triggerMagicEffect(e);
        }
      } catch (err) {
        console.error("Magic effect error:", err);
      }
    };
    document.addEventListener('click', handleGlobalClick);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        // Check or create user profile with role in Firestore
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const userData = userSnap.data();
          const userRole = userData.role || 'user';
          
          let userApproved = userData.isApproved;
          // 기존에 가입된 'admin'이 isApproved 속성이 없는 경우 자동으로 승인 처리 (잠김 방지)
          if (userRole === 'admin' && userApproved === undefined) {
            userApproved = true;
            await updateDoc(userRef, { isApproved: true });
          }
          
          setRole(userRole);
          setIsApproved(userApproved || false);
        } else {
          // Check if it's the first user
          const usersSnap = await getDocs(collection(db, 'users'));
          const isFirstUser = usersSnap.empty;

          await setDoc(userRef, {
            email: currentUser.email,
            displayName: currentUser.displayName,
            role: isFirstUser ? 'admin' : 'user',
            isApproved: true, // 임시: 누구나 바로 들어올 수 있도록 자동 승인
            createdAt: new Date()
          });
          setRole(isFirstUser ? 'admin' : 'user');
          setIsApproved(true);
        }
      } else {
        setUser(null);
        setRole(null);
        setIsApproved(false);
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
      document.removeEventListener('click', handleGlobalClick);
    };
  }, []);

  if (loading) {
    return (
      <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <p>Loading...</p>
      </div>
    );
  }

function PendingApproval() {
  return (
    <div className="container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', textAlign: 'center' }}>
      <div className="glass-card animate-fade-in" style={{ padding: '3rem', maxWidth: '500px' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: 'var(--text-bright)' }}>승인 대기 중입니다 ⏳</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
          관리자가 계정을 승인해야 리조트 시스템에 접근하실 수 있습니다.<br/>잠시만 기다려주세요.
        </p>
        <button className="btn" onClick={() => signOut(auth)}>로그아웃</button>
      </div>
    </div>
  );
}

  return (
    <Router>
      <Routes>
        <Route 
          path="/login" 
          element={!user ? <Login /> : <Navigate to="/dashboard" />} 
        />
        <Route 
          path="/dashboard" 
          element={user ? (isApproved ? <Dashboard user={user} role={role} /> : <PendingApproval />) : <Navigate to="/login" />} 
        />
        <Route 
          path="*" 
          element={<Navigate to={user ? "/dashboard" : "/login"} />} 
        />
      </Routes>
    </Router>
  );
}

export default App;
