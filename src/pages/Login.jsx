import { useAuth } from '../lib/auth';
import { Package, AlertTriangle } from 'lucide-react';

export default function Login() {
  const { loginWithGoogle, authError } = useAuth();

  return (
    <div className="min-h-screen bg-cream-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl border border-cream-200 shadow-lg p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-cream-100 rounded-2xl mb-5">
            <Package size={32} className="text-accent" />
          </div>

          <h1 className="font-heading font-bold text-2xl text-cream-900 mb-1">
            Lifewell
          </h1>
          <p className="text-sm font-body text-cream-500 mb-8">
            出荷業務管理システム
          </p>

          {authError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6 text-left">
              <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm font-body text-red-700">{authError}</p>
            </div>
          )}

          <button
            onClick={loginWithGoogle}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-cream-200 hover:border-cream-300 text-cream-800 font-body font-bold py-3 rounded-xl transition-colors hover:shadow-md"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Google アカウントでログイン
          </button>
        </div>

        <p className="text-center text-xs font-body text-cream-400 mt-6">
          Lifewell Inc. All rights reserved.
        </p>
      </div>
    </div>
  );
}
