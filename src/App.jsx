import { AuthProvider, useAuth } from './lib/auth';
import ShippingApp from './components/ShippingApp';
import Login from './pages/Login';
import { Package } from 'lucide-react';

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-cream-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-white rounded-2xl shadow-sm mb-4">
            <Package size={28} className="text-accent animate-pulse" />
          </div>
          <div className="animate-spin w-5 h-5 border-2 border-accent border-t-transparent rounded-full mx-auto" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return <ShippingApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
