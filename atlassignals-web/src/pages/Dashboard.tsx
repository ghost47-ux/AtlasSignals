/**
 * Dashboard.tsx — live signal feed + access state + upgrade + Telegram link.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import Countdown from '../components/Countdown';
import SignalCard from '../components/SignalCard';
import TelegramConnect from '../components/TelegramConnect';
import { useAuth } from '../context/AuthContext';
import { getMarketInfo, useNow } from '../hooks/useMarket';
import { useSignals } from '../hooks/useSignals';
import { initializePayment } from '../lib/api';
import { PLAN_LABEL, SESSION } from '../lib/site';
import { supabase } from '../lib/supabase';

export default function Dashboard() {
  const { session, profile, subscription, access, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const now = useNow(1000);
  const market = getMarketInfo(now);

  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingPayment, setPendingPayment] = useState(false);
  const pollTimer = useRef<number | null>(null);
  const autoUpgradeRan = useRef(false);

  const { signals, loading: signalsLoading, live, refresh } = useSignals();

  // ── Upgrade flow ─────────────────────────────────────────────────────────
  const startCheckout = useCallback(async () => {
    if (!session) {
      navigate('/auth?mode=login');
      return;
    }
    setPaying(true);
    setPayError(null);
    try {
      const res = await initializePayment(session.access_token);
      // Redirect to Paystack; the verified webhook activates the account.
      window.location.assign(res.authorization_url);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Could not start checkout.');
      setPaying(false);
    }
  }, [session, navigate]);

  // ?upgrade=1 (e.g. from the chatbot action) → auto-start checkout ONCE per
  // page load. The ref guards against re-triggering when Paystack redirects
  // back to this same URL after the payment completes.
  useEffect(() => {
    if (params.get('upgrade') === '1' && session && !paying && !autoUpgradeRan.current) {
      autoUpgradeRan.current = true;
      // Drop the param so a later reload cannot re-open checkout.
      window.history.replaceState(null, '', '/dashboard');
      void startCheckout();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, session]);

  // Track whether a Paystack transaction is actually in flight (a `pending`
  // payment row exists) — the confirmation poll only runs in that case, so
  // weekend users with a future-dated trial are not polled pointlessly.
  useEffect(() => {
    if (!profile) return;
    supabase
      .from('payments')
      .select('status')
      .eq('user_id', profile.id)
      .limit(5)
      .then(({ data }) => {
        setPendingPayment(Boolean(data && data.some((p) => p.status === 'pending')));
      });
  }, [profile]);

  // ── Poll for payment confirmation while a payment is pending ─────────────
  useEffect(() => {
    if (access.ok || !profile || !pendingPayment) return;
    setCheckingPayment(true);
    const start = Date.now();
    const tick = () => {
      void refreshProfile();
      if (Date.now() - start > 4 * 60_000) {
        if (pollTimer.current) window.clearInterval(pollTimer.current);
        setCheckingPayment(false);
        setToast('Still waiting? Your payment may take a moment — try refreshing.');
      }
    };
    tick();
    pollTimer.current = window.setInterval(tick, 10_000);
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
  }, [access.ok, profile, pendingPayment, refreshProfile]);

  // ── Access panel content ─────────────────────────────────────────────────
  const renderAccess = () => {
    if (access.kind === 'admin') {
      return (
        <div className="glass panel">
          <h2>
            Access <span className="badge badge-gold">Admin</span>
          </h2>
          <p className="muted" style={{ fontSize: 14.5 }}>
            Full access — all signals, always.
          </p>
        </div>
      );
    }
    if (access.kind === 'trial' && access.ends) {
      return (
        <div className="glass panel">
          <h2>
            Free trial <span className="badge badge-green"><span className="dot" /> Live</span>
          </h2>
          <p className="muted" style={{ fontSize: 13.5, marginBottom: 10 }}>
            Ends in:
          </p>
          <Countdown target={access.ends} />
          <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={() => void startCheckout()} disabled={paying}>
            {paying ? 'Opening checkout…' : `Upgrade now — ${PLAN_LABEL}`}
          </button>
          {payError && <p className="form-error" style={{ marginTop: 10 }}>{payError}</p>}
        </div>
      );
    }
    if (access.kind === 'paid' && access.ends) {
      return (
        <div className="glass panel">
          <h2>
            Pro <span className="badge badge-blue">Active</span>
          </h2>
          <p className="muted" style={{ fontSize: 13.5, marginBottom: 10 }}>
            Renews/extends — access until:
          </p>
          <Countdown target={access.ends} />
        </div>
      );
    }
    if (access.kind === 'trial_pending' && access.starts) {
      return (
        <div className="glass panel">
          <h2>
            Free trial <span className="badge badge-gold">Starts Monday</span>
          </h2>
          <p className="muted" style={{ fontSize: 13.5, marginBottom: 10 }}>
            You signed up over the weekend — your 24h trial begins when the market opens:
          </p>
          <Countdown target={access.starts} />
          <p className="dim" style={{ fontSize: 12.5, marginTop: 12 }}>
            No signals are generated while the market is closed, so nothing is lost.
          </p>
        </div>
      );
    }
    // Expired / none.
    return (
      <div className="glass panel">
        <h2>
          {access.kind === 'trial_expired' ? 'Trial ended' : access.kind === 'paid_expired' ? 'Subscription ended' : 'No active access'}
        </h2>
        <p className="muted" style={{ fontSize: 14.5, marginBottom: 16 }}>
          {access.kind === 'trial_expired'
            ? 'Your 24-hour free trial has ended. Upgrade to keep receiving signals instantly.'
            : 'Upgrade to Pro and signals flow to your dashboard and Telegram the moment they are approved.'}
        </p>
        <button className="btn btn-primary btn-block" onClick={() => void startCheckout()} disabled={paying}>
          {paying ? 'Opening checkout…' : `Upgrade — ${PLAN_LABEL}`}
        </button>
        {payError && <p className="form-error" style={{ marginTop: 10 }}>{payError}</p>}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="center-loading dash">
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  if (!session) {
    // <Navigate> instead of navigate()+null: render-safe, so the routed page
    // always commits (the old pattern could leave a blank main after the
    // chatbot navigated here while signed out).
    return <Navigate to="/auth?mode=login" replace />;
  }

  return (
    <div className="dash">
      <div className="container">
        <div className="dash-head">
          <div>
            <h1>
              {market.marketOpen ? 'Live signals' : 'Market closed'} ·{' '}
              <span className="muted" style={{ fontSize: '0.55em' }}>XAU/USD</span>
            </h1>
            <p className="muted" style={{ fontSize: 14 }}>
              {market.marketOpen
                ? 'Approved setups, delivered in real time.'
                : 'Signals resume Monday. Your access keeps ticking — nothing is lost.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className={`badge ${live ? 'badge-green' : ''}`}>
              {live ? <><span className="dot" /> Live</> : 'Connecting…'}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
              ↻ Refresh
            </button>
          </div>
        </div>

        {checkingPayment && !access.ok && (
          <div className="badge badge-gold" style={{ marginBottom: 18 }}>
            Checking payment status… access appears the moment Paystack confirms.
          </div>
        )}

        <div className="dash-grid">
          {/* Feed */}
          <div>
            {access.ok ? (
              <div className="signal-list">
                {signalsLoading && signals.length === 0 ? (
                  <div className="glass panel empty-state">
                    <div className="big">⚡</div>Loading latest signals…
                  </div>
                ) : signals.length === 0 ? (
                  <div className="glass panel empty-state">
                    <div className="big">📡</div>
                    No signals yet — the engine writes the first approved setup here.
                    <p className="dim" style={{ fontSize: 13, maxWidth: 440, margin: '12px auto 0' }}>
                      The engine analyses gold across four timeframes (4H bias → 1H level →
                      15M confirmation → 5M timing), re-running the full context engine at
                      every 15-minute close ({SESSION.hours}). Read the full mechanics on the{' '}
                      <Link to="/method" style={{ color: 'var(--green)' }}>Inside the engine</Link> page.
                    </p>
                  </div>
                ) : (
                  signals.map((s) => <SignalCard key={s.signal_id} signal={s} />)
                )}
              </div>
            ) : (
              <div className="glass panel lock-screen">
                <div className="icon">🔒</div>
                <h2 style={{ marginBottom: 10 }}>Signals are locked</h2>
                <p className="muted" style={{ maxWidth: 420, margin: '0 auto 22px', fontSize: 14.5 }}>
                  {access.kind === 'trial_pending'
                    ? 'Your free trial starts when the market opens on Monday — check the countdown on the right.'
                    : 'Upgrade to unlock the live feed. Access activates automatically the moment Paystack confirms your payment.'}
                </p>
                {access.kind !== 'trial_pending' && (
                  <button className="btn btn-primary" onClick={() => void startCheckout()} disabled={paying}>
                    {paying ? 'Opening checkout…' : `Upgrade — ${PLAN_LABEL}`}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {renderAccess()}
            <TelegramConnect />
          </div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
