import { createContext, useContext, useEffect, useState } from 'react';
import { auth, db, isFirebaseConfigured } from './firebase';
import { getInviteByEmail } from './firestore-helpers';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    // Firebase設定済み: 通常の認証フロー
    let unsubscribe = () => {};

    (async () => {
      const { onAuthStateChanged, signOut } = await import('firebase/auth');
      const { doc, getDoc, setDoc, serverTimestamp } = await import('firebase/firestore');

      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          const profileRef = doc(db, 'profiles', firebaseUser.uid);
          const profileSnap = await getDoc(profileRef);

          if (profileSnap.exists()) {
            // 既存プロフィール: そのまま使用
            setUser(firebaseUser);
            setProfile({ id: profileSnap.id, ...profileSnap.data() });
          } else {
            // 初回ログイン: 招待リストを確認
            const invite = await getInviteByEmail(firebaseUser.email);
            if (!invite) {
              // 招待なし → 強制サインアウト
              await signOut(auth);
              setAuthError(`${firebaseUser.email} はアクセスが許可されていません。`);
              setUser(null);
              setProfile(null);
              setLoading(false);
              return;
            }
            const newProfile = {
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              photoURL: firebaseUser.photoURL,
              role: invite.role,
              createdAt: serverTimestamp(),
            };
            await setDoc(profileRef, newProfile);
            setUser(firebaseUser);
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
    setAuthError(null);
    const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        setAuthError('ログインに失敗しました。再度お試しください。');
      }
    }
  };

  const logout = async () => {
    const { signOut } = await import('firebase/auth');
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, authError, loginWithGoogle, logout }}
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
