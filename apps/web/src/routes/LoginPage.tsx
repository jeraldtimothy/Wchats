import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { authClient } from '../api/auth';
import { qk, useConfig, useMe } from '../api/queries';
import { Logo } from '../components/Logo';

type Mode = 'signin' | 'signup';

const input =
  'w-full rounded-md border border-lc-border bg-lc-input px-3 py-2 text-[15px] outline-none transition focus:border-lc-blue focus:bg-lc-white';

export function LoginPage() {
  const me = useMe();
  const config = useConfig();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.data) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res =
      mode === 'signin'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: name.trim() || email.split('@')[0]! });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? 'Something went wrong. Please try again.');
      return;
    }
    await qc.invalidateQueries({ queryKey: qk.me });
    navigate(from, { replace: true });
  }

  async function google() {
    await authClient.signIn.social({ provider: 'google', callbackURL: `${window.location.origin}/` });
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-lg border border-lc-border bg-lc-white p-6 shadow-md">
          <h1 className="text-xl font-medium">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="mt-1 text-sm text-lc-grey">Pay only for what you use. No subscription.</p>

          <form onSubmit={submit} className="mt-5 space-y-3">
            {mode === 'signup' && (
              <label className="block">
                <span className="section-label">Name</span>
                <input className={`${input} mt-1`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </label>
            )}
            <label className="block">
              <span className="section-label">Email</span>
              <input
                className={`${input} mt-1`}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <label className="block">
              <span className="section-label">Password</span>
              <input
                className={`${input} mt-1`}
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-lc-error">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="focus-ring w-full rounded-md bg-lc-blue py-2.5 text-[15px] font-medium text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
            >
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          {config.data?.googleAuthEnabled && (
            <>
              <div className="my-4 flex items-center gap-3 text-xs text-lc-grey">
                <span className="h-px flex-1 bg-lc-border" /> or <span className="h-px flex-1 bg-lc-border" />
              </div>
              <button
                type="button"
                onClick={google}
                className="focus-ring w-full rounded-md border border-lc-border bg-lc-white py-2.5 text-[15px] font-medium hover:bg-lc-light"
              >
                Continue with Google
              </button>
            </>
          )}
        </div>
        <p className="mt-4 text-center text-sm text-lc-grey">
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            className="focus-ring font-medium text-lc-blue hover:underline"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError(null);
            }}
          >
            {mode === 'signin' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
