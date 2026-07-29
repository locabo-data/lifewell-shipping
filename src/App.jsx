import { AuthProvider, useAuth } from './lib/auth';
import ShippingApp from './components/ShippingApp';
import Login from './pages/Login';
import { Package } from 'lucide-react';

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

// ─── 通常アプリ ────────────────────────────────────────────────────────────────

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingPage />;
  if (!user)   return <Login />;
  return <ShippingApp />;
}

// ─── ルートコンポーネント ──────────────────────────────────────────────────────

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
