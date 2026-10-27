'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import { apiClient } from '@/lib/api-client';
import { ShieldCheck, KeyRound, AlertCircle, ArrowRight } from 'lucide-react';
import { AdminUser } from '@/types';

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaChallengeId, setMfaChallengeId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const redirectUrl =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('redirect') || '/customers'
        : '/customers';

    try {
      if (!mfaChallengeId) {
        // Step 1: Staff email + password verification
        const res = await apiClient.post('/auth/staff/login', {
          email: email.trim(),
          password,
        });

        const data = res.data?.data || res.data;
        if (data?.mfaRequired && data?.mfaToken) {
          setMfaChallengeId(data.mfaToken);
        } else {
          throw new Error('MFA challenge required.');
        }
      } else {
        // Step 2: MFA TOTP verification using server-issued challenge token
        const res = await apiClient.post('/auth/staff/mfa', {
          mfaToken: mfaChallengeId,
          code: mfaCode.trim(),
        });

        const data = res.data?.data || res.data;
        if (!data?.accessToken) {
          throw new Error('Authentication failed: no session token issued.');
        }

        const rawUser = data.user;
        const adminUser: AdminUser = {
          id: rawUser?.id || rawUser?._id || '',
          name: rawUser?.name || email.split('@')[0] || 'Staff Member',
          email: rawUser?.email || email.trim(),
          role: rawUser?.role || 'SUPER_ADMIN',
          status: rawUser?.status || rawUser?.accountStatus || 'ACTIVE',
        };

        setUser(adminUser, data.accessToken);
        if (data.refreshToken && typeof window !== 'undefined') {
          localStorage.setItem('refresh_token', data.refreshToken);
        }
        router.push(redirectUrl);
      }
    } catch (err: any) {
      const message =
        err?.response?.data?.error?.message ||
        err?.error?.message ||
        err?.message ||
        'Authentication failed. Please verify credentials.';
      setError(message);
      if (message.includes('expired') || message.includes('Start again')) {
        setMfaChallengeId(null);
        setMfaCode('');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancelMfa = () => {
    setMfaChallengeId(null);
    setMfaCode('');
    setError(null);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl backdrop-blur-xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-500/30">
            {mfaChallengeId ? <ShieldCheck className="h-6 w-6" /> : <KeyRound className="h-6 w-6" />}
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            {mfaChallengeId ? 'Two-Factor Verification' : 'Admin Operations Control'}
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            {mfaChallengeId
              ? 'Enter the 6-digit code from your authenticator app'
              : 'Enter authorized administrative credentials to access operations'}
          </p>
        </div>

        {error && (
          <div className="mb-6 flex items-center space-x-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          {!mfaChallengeId ? (
            <>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Admin Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@platform.internal"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  required
                />
              </div>
            </>
          ) : (
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  6-Digit Security Code
                </label>
                <button
                  type="button"
                  onClick={handleCancelMfa}
                  className="text-xs text-indigo-400 hover:text-indigo-300"
                >
                  Change email
                </button>
              </div>
              <input
                type="text"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="000000"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-center text-lg font-mono tracking-widest text-white focus:border-indigo-500 focus:outline-none"
                required
                autoFocus
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex w-full items-center justify-center space-x-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition disabled:opacity-50"
          >
            <span>{loading ? 'Authenticating...' : mfaChallengeId ? 'Confirm & Access' : 'Authenticate'}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
