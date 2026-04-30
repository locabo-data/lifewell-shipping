import { createContext, useContext, useEffect, useState } from 'react';
import { auth, db, isFirebaseConfigured } from './firebase';
import { getInviteByEmail } from './firestore-helpers';

const AuthContext = createContext(null);

// DEMOユーザー（Firebase未設定時）
const DEMO_USER = {
  uid: 'demo-user',
  email: 'demo@lifewell.jp',
  displayName: 'DEMOユーザー',
  photoURL: null,
};

const DEMO_PROFILE = {
  id: 'demo-user',
  email: 'demo@lifewell.jp',
  displayName: 'DEMOユーザー',
  photoURL: null,
  role: 'admin',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      // Firebase未設定: DEMOモードで自動ログイン
      setUser(DEMO_USER);
      setProfile(DEMO_PROFILE);
      setLoading(false);
      return;
    }

    // Firebase設定済み: 通常の認証フロー
    let unsubscribe = () => {};

    (async () => {
      const { onAuthStateChanged } = await import('firebase/auth');
      const { doc, getDoc, setDoc, serverTimestamp } = await import('firebase/firestore');

      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          // イベントデモユーザー: Firestore 読み書きをスキップして固定プロフィールを返す
          if (firebaseUser.uid === 'demo-event-user') {
            setUser(firebaseUser);
            setProfile({
              id: 'demo-event-user',
              email: 'event-demo@lifewell.jp',
              displayName: 'イベントデモ',
              role: 'operator',
            });
            setLoading(false);
            return;
          }

          setUser(firebaseUser);
          const profileRef = doc(db, 'profiles', firebaseUser.uid);
          const profileSnap = await getDoc(profileRef);

          if (profileSnap.exists()) {
            setProfile({ id: profileSnap.id, ...profileSnap.data() });
          } else {
            // 事前登録リストを確認してロールを決定
            const invite = await getInviteByEmail(firebaseUser.email);
            const newProfile = {
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              photoURL: firebaseUser.photoURL,
              role: invite?.role ?? 'viewer',
              createdAt: serverTimestamp(),
            };
            await setDoc(profileRef, newProfile);
            setProfile({ id: firebaseUser.uid, ...newProfile });
          }
        } else {
          setUser(null);
          setProfile(null);
        }
        setLoading(false);
      });
    })();

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    if (!isFirebaseConfigured) {
      setUser(DEMO_USER);
      setProfile(DEMO_PROFILE);
      return;
    }
    const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const logout = async () => {
    if (!isFirebaseConfigured) {
      setUser(null);
      setProfile(null);
      return;
    }
    const { signOut } = await import('firebase/auth');
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, loginWithGoogle, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
