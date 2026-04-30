import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import ShippingApp from './components/ShippingApp';
import Login from './pages/Login';
import { Package, AlertTriangle, Clock } from 'lucide-react';
import { auth, isFirebaseConfigured } from './lib/firebase';

// ─── デモ用ページコンポーネント ───────────────────────────────────────────────

function LoadingPage({ message }) {
  return (
    <div className="min-h-screen bg-cream-100 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-white rounded-2xl shadow-sm mb-4">
          <Package size={28} className="text-accent animate-pulse" />
        </div>
        <p className="text-sm text-gray-500 mt-2">{message || '読み込み中...'}</p>
        <div className="animate-spin w-5 h-5 border-2 border-accent border-t-transparent rounded-full mx-auto mt-3" />
      </div>
    </div>
  );
}

function DemoExpiredPage() {
  return (
    <div className="min-h-screen bg-cream-100 flex items-center justify-center">
      <div className="text-center max-w-sm mx-auto px-6">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-orange-100 rounded-2xl shadow-sm mb-4">
          <Clock size={32} className="text-orange-500" />
        </div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">デモ期限切れ</h1>
        <p className="text-sm text-gray-500">
          このデモURLの有効期限が終了しました。<br />
          ご不明な点はご担当者にお問い合わせください。
        </p>
      </div>
    </div>
  );
}

function DemoErrorPage() {
  return (
    <div className="min-h-screen bg-cream-100 flex items-center justify-center">
      <div className="text-center max-w-sm mx-auto px-6">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-2xl shadow-sm mb-4">
          <AlertTriangle size={32} className="text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">アクセスできません</h1>
        <p className="text-sm text-gray-500">
          このデモURLは無効です。<br />
          正しいURLをご確認ください。
        </p>
      </div>
    </div>
  );
}

// ─── メインコンテンツ ──────────────────────────────────────────────────────────

function AppContent() {
  const { user, loading } = useAuth();

  // /demo/TOKEN パスを検出（レンダー前に確定させる）
  const pathMatch = window.location.pathname.match(/^\/demo\/([^/]+)$/);
  const urlToken = pathMatch?.[1] ?? null;

  // 'idle' | 'validating' | 'ready' | 'expired' | 'error'
  // デモURLの場合は初期値を 'validating' にしてLogin画面の瞬間表示を防ぐ
  const [demoState, setDemoState] = useState(() => urlToken ? 'validating' : 'idle');
  const [isEventDemo, setIsEventDemo] = useState(false);

  useEffect(() => {
    if (!urlToken) return;
    // Firebase auth の初期化が終わるまで待つ
    if (loading) return;

    // 既にサインイン済み（ページリロード等: 匿名ユーザーが持続している）
    if (user) {
      setIsEventDemo(true);
      setDemoState('ready');
      return;
    }

    // 未サインイン: サーバーでトークン検証 → 匿名認証でサインイン
    (async () => {
      try {
        const res = await fetch(`/api/demo?token=${encodeURIComponent(urlToken)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setDemoState(body.error === 'Demo expired' ? 'expired' : 'error');
          return;
        }

        if (isFirebaseConfigured) {
          const { signInAnonymously } = await import('firebase/auth');
          await signInAnonymously(auth);
          // onAuthStateChanged が user をセット → effect が再実行 → ready になる
        } else {
          // Firebase未設定環境（ローカル開発）: 直接 ready に
          setIsEventDemo(true);
          setDemoState('ready');
        }
      } catch (err) {
        console.error('Demo auth error:', err);
        setDemoState('error');
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlToken, loading, user]);

  // /demo/ パスのときの分岐
  if (urlToken) {
    if (demoState === 'validating') {
      return <LoadingPage message="デモを準備中..." />;
    }
    if (demoState === 'expired') {
      return <DemoExpiredPage />;
    }
    if (demoState === 'error') {
      return <DemoErrorPage />;
    }
  }

  // 通常の認証フロー
  if (loading) {
    return <LoadingPage />;
  }

  if (!user) {
    return <Login />;
  }

  return <ShippingApp isEventDemo={isEventDemo} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
