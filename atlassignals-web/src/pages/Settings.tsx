/**
 * Settings.tsx — profile, subscription details, Telegram linking, payment
 * history, sign out.
 */
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import TelegramConnect from '../components/TelegramConnect';
import { useAuth } from '../context/AuthContext';
import { fmtDateTime, fmtPrice } from '../lib/format';
import { supabase, type PaymentRow } from '../lib/supabase';

export default function Settings() {
  const { session, profile, subscription, access, loading, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [signingOut, setSigningOut] = useState(false);

  const connectTelegram = Boolean((location.state as { connectTelegram?: boolean } | null)?.connectTelegram);

  useEffect(() => {
    if (!session) return;
    void refreshProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (!profile) return;
    supabase
      .from('payments')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data, error }) => {
        if (!error && data) setPayments(data as PaymentRow[]);
      });
  }, [profile]);

  if (loading) {
    return (
      <div className="center-loading dash">
        <div className="spinner spinner-lg" />
      </div>
    );
  }
  if (!session) {
    // Render-safe redirect (see Dashboard) — avoids a blank page on nav.
    return <Navigate to="/auth?mode=login" replace />;
  }

  const statusLabel = (s: string) => {
    const map: Record<string, { t: string; cls: string }> = {
      trial: { t: 'Trial', cls: 'badge-green' },
      active: { t: 'Active', cls: 'badge-blue' },
      canceled: { t: 'Canceled', cls: 'badge-gold' },
      expired: { t: 'Expired', cls: 'badge-red' },
    };
    const m = map[s] ?? { t: s, cls: '' };
    return <span className={`badge ${m.cls}`}>{m.t}</span>;
  };

  return (
    <div className="dash">
      <div className="container" style={{ maxWidth: 820 }}>
        <div className="dash-head">
          <div>
            <h1>Settings</h1>
            <p className="muted" style={{ fontSize: 14 }}>
              Your account, delivery channels and billing.
            </p>
          </div>
          <button
            className="btn btn-danger btn-sm"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void signOut().then(() => navigate('/', { replace: true }));
            }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Profile */}
          <div className="glass panel">
            <h2>Profile</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="badge" style={{ alignSelf: 'flex-start' }}>
                {profile?.role === 'admin' ? '👑 Admin' : profile?.role === 'paid' ? '💎 Pro' : '✨ Free trial'}
              </div>
              <div>
                <div className="dim" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Email</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14.5 }}>{profile?.email}</div>
              </div>
              <div>
                <div className="dim" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Member since</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14.5 }}>{fmtDateTime(profile?.created_at)}</div>
              </div>
              {subscription && (
                <div>
                  <div className="dim" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Plan</div>
                  <div style={{ fontSize: 14.5 }}>
                    {subscription.status === 'trial'
                      ? `Free trial · ${fmtDateTime(subscription.trial_ends_at)}`
                      : subscription.status === 'active'
                        ? `Pro · renews ${fmtDateTime(subscription.ends_at)}`
                        : statusLabel(subscription.status)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Telegram */}
          <TelegramConnect autoStart={connectTelegram} />

          {/* Payments */}
          <div className="glass panel">
            <h2>Payment history</h2>
            {payments.length === 0 ? (
              <p className="dim" style={{ fontSize: 14 }}>
                No payments yet. {access.ok ? '' : 'Upgrade to Pro to see billing here.'}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {payments.map((p) => (
                  <div key={p.id} className="glass" style={{ padding: '12px 16px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div>
                      <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
                        {p.currency} {fmtPrice(p.amount, 2)}
                      </div>
                      <div className="dim" style={{ fontSize: 12 }}>{fmtDateTime(p.created_at)}</div>
                    </div>
                    <span className={`badge ${p.status === 'success' ? 'badge-green' : p.status === 'pending' ? 'badge-gold' : p.status === 'failed' ? 'badge-red' : ''}`}>
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
