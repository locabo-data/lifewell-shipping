import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import ShippingApp from './components/ShippingApp';
import Login from './pages/Login';
import { Package, AlertTriangle, Clock } from 'lucide-react';

// ─── 共通UIパーツ ──────────────────────────────────────────────────────────────

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

// ─── デモ専用アプリ（AuthProvider と完全分離）────────────────────────────────────

function DemoApp({ urlToken }) {
  // 'validating' | 'ready' | 'expired' | 'error'
  const [state, setState] = useState('validating');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/demo?token=${encodeURIComponent(urlToken)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setState(body.error === 'Demo expired' ? 'expired' : 'error');
          return;
        }
        setState('ready');
      } catch (err) {
        console.error('Demo auth error:', err);
        setState('error');
      }
    })();
  // urlToken は固定値なので依存配列に含めるが実質1回のみ実行
  }, [urlToken]);

  if (state === 'validating') return <LoadingPage message="デモを準備中..." />;
  if (state === 'expired')   return <DemoExpiredPage />;
  if (state === 'error')     return <DemoErrorPage />;

  // ready: AuthProvider なしで直接 ShippingApp を表示
  return (
    <AuthProvider>
      <ShippingApp isEventDemo={true} eventDemoToken={urlToken} />
    </AuthProvider>
  );
}

// ─── 通常アプリ ────────────────────────────────────────────────────────────────

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingPage />;
  if (!user)   return <Login />;
  return <ShippingApp />;
}

// ─── ルートコンポーネント ──────────────────────────────────────────────────────

export default function App() {
  // デモURLを最初に判定し、完全に別のコンポーネントツリーへ分岐
  const pathMatch = window.location.pathname.match(/^\/demo\/([^/]+)$/);
  const urlToken = pathMatch?.[1] ?? null;

  if (urlToken) {
    return <DemoApp urlToken={urlToken} />;
  }

  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
