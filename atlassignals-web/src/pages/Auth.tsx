/**
 * Auth.tsx — sign in / sign up. Google OAuth (one tap) + email/password.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Background from '../components/Background';
import Logo from '../components/Logo';
import { useAuth } from '../context/AuthContext';
import { SITE_URL } from '../lib/site';
import { supabase } from '../lib/supabase';

type Mode = 'login' | 'signup';

export default function Auth() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { session } = useAuth();

  const [mode, setMode] = useState<Mode>(() =>
    params.get('mode') === 'login' ? 'login' : 'signup',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  // Already signed in → dashboard.
  useEffect(() => {
    if (session) navigate('/dashboard', { replace: true });
  }, [session, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${SITE_URL}/auth` },
        });
        if (signUpErr) {
          setError(signUpErr.message);
        } else {
          setCheckEmail(true); // confirmation email sent (or session created)
        }
      } else {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInErr) setError(signInErr.message);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setGoogleBusy(true);
    setError(null);
    try {
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${SITE_URL}/auth` },
      });
      if (oauthErr) setError(oauthErr.message);
    } catch {
      setError('Google sign-in failed. Please try again.');
    } finally {
      setGoogleBusy(false);
    }
  };

  if (checkEmail) {
    return (
      <>
        <Background />
        <div className="auth-shell">
          <div className="glass auth-card" style={{ textAlign: 'center' }}>
            <div style={{ display: 'grid', placeItems: 'center', marginBottom: 18 }}>
              <Logo showWord={false} size={48} />
            </div>
            <h2 style={{ marginBottom: 10 }}>Check your inbox</h2>
            <p className="muted" style={{ fontSize: 14.5, marginBottom: 22 }}>
              We sent a confirmation link to <strong>{email}</strong>. Click it to activate
              your account — your 24-hour free trial starts as soon as you do.
            </p>
            <button className="btn btn-ghost btn-block" onClick={() => setCheckEmail(false)}>
              Back to sign in
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Background />
      <div className="auth-shell">
        <div className="glass auth-card">
          <div style={{ display: 'grid', placeItems: 'center', marginBottom: 8 }}>
            <Logo size={44} />
          </div>
          <p className="dim" style={{ textAlign: 'center', fontSize: 13.5, marginBottom: 22 }}>
            {mode === 'signup'
              ? 'Create your account — 24h free trial included.'
              : 'Welcome back to the signal room.'}
          </p>

          <div className="auth-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={mode === 'login'}
              className={mode === 'login' ? 'active' : ''}
              onClick={() => {
                setMode('login');
                setError(null);
              }}
            >
              Sign in
            </button>
            <button
              role="tab"
              aria-selected={mode === 'signup'}
              className={mode === 'signup' ? 'active' : ''}
              onClick={() => {
                setMode('signup');
                setError(null);
              }}
            >
              Create account
            </button>
          </div>

          <button className="google-btn" onClick={() => void google()} disabled={googleBusy}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            {googleBusy ? 'Connecting…' : `Continue with Google`}
          </button>

          <div className="divider">or use email</div>

          {error && <p className="form-error">{error}</p>}

          <form onSubmit={(e) => void submit(e)}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                className="input"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="dim" style={{ fontSize: 12, marginTop: 18, textAlign: 'center' }}>
            By continuing you agree that signals are informational output, not financial advice.
          </p>
          <p className="dim" style={{ fontSize: 12.5, marginTop: 8, textAlign: 'center' }}>
            <Link to="/" style={{ color: 'var(--green)' }}>
              ← Back to home
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
