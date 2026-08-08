/**
 * TelegramConnect.tsx — link/unlink the signed-in user's Telegram chat.
 *
 * Flow: the backend issues a one-time code (POST /telegram/link, JWT) → the
 * user taps the deep link (or scans the QR) → the bot webhook redeems it and
 * the chat becomes a verified delivery channel. This component polls the
 * user's own delivery_channels (RLS) until the chat shows up.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { createTelegramLink } from '../lib/api';
import { TELEGRAM_BOT_LINK, TELEGRAM_BOT_USERNAME } from '../lib/site';
import { supabase, type DeliveryChannelRow } from '../lib/supabase';
import Countdown from './Countdown';

type Phase = 'idle' | 'creating' | 'pending' | 'linked' | 'error';

export default function TelegramConnect({ autoStart = false }: { autoStart?: boolean }) {
  const { session, profile, channels, refreshProfile } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const autoRan = useRef(false);

  const linked = channels.find(
    (c) => c.channel_type === 'telegram' && c.is_verified,
  ) as DeliveryChannelRow | undefined;

  useEffect(() => {
    if (linked) setPhase('linked');
  }, [linked]);

  // Poll for the verified channel while a code is pending.
  useEffect(() => {
    if (phase !== 'pending' || !session) return;
    pollRef.current = window.setInterval(async () => {
      if (!profile) return;
      const { data } = await supabase
        .from('delivery_channels')
        .select('*')
        .eq('user_id', profile.id)
        .eq('channel_type', 'telegram');
      if (data && data.length > 0 && data[0].is_verified) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        await refreshProfile();
        setPhase('linked');
      }
    }, 2500);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [phase, session, profile, refreshProfile]);

  const start = useCallback(async () => {
    if (!session) return;
    setPhase('creating');
    setError(null);
    try {
      const res = await createTelegramLink(session.access_token);
      setCode(res.code);
      setExpiresAt(res.expires_at);
      setPhase('pending');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create link code.');
      setPhase('error');
    }
  }, [session]);

  const disconnect = useCallback(async () => {
    if (!linked || !profile) return;
    const { error: delErr } = await supabase
      .from('delivery_channels')
      .delete()
      .eq('user_id', profile.id)
      .eq('channel_type', 'telegram')
      .eq('channel_identifier', linked.channel_identifier);
    if (!delErr) {
      await refreshProfile();
      setPhase('idle');
      setCode(null);
      setExpiresAt(null);
    }
  }, [linked, profile, refreshProfile]);

  // Auto-start the linking flow (used when the chatbot routes the user here).
  useEffect(() => {
    if (autoStart && !autoRan.current && phase === 'idle' && session && !linked) {
      autoRan.current = true;
      void start();
    }
  }, [autoStart, phase, session, linked, start]);

  if (phase === 'linked' && linked) {
    return (
      <div className="glass panel">
        <h2>
          Telegram <span className="badge badge-green"><span className="dot" /> Connected</span>
        </h2>
        <p className="muted" style={{ fontSize: 14.5, marginBottom: 8 }}>
          Signals are delivered instantly to this chat whenever they are approved.
        </p>
        <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>
          chat id <span className="green">@{linked.channel_identifier}</span> · via{' '}
          <span className="cyan">@{TELEGRAM_BOT_USERNAME}</span>
        </div>
        <button className="btn btn-danger btn-sm" onClick={() => void disconnect()}>
          Disconnect Telegram
        </button>
      </div>
    );
  }

  return (
    <div className="glass panel">
      <h2>Telegram delivery</h2>
      <p className="muted" style={{ fontSize: 14.5, marginBottom: 16 }}>
        Link your Telegram account and every approved signal lands in your chat
        the moment it is written to the database — sub-second delivery.
      </p>

      {phase === 'pending' && code && expiresAt && (
        <div style={{ marginBottom: 16 }}>
          <div className="badge badge-green" style={{ marginBottom: 14 }}>
            <span className="dot" /> Waiting for you to link…
          </div>
          <p className="muted" style={{ fontSize: 13.5, marginBottom: 12 }}>
            Tap the button below (or scan the QR with your phone) — the code
            expires in 10 minutes:
          </p>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <a
              className="btn btn-primary"
              href={TELEGRAM_BOT_LINK(code)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open @{TELEGRAM_BOT_USERNAME}
            </a>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(
                TELEGRAM_BOT_LINK(code),
              )}`}
              alt="Telegram link QR code"
              width={140}
              height={140}
              style={{ borderRadius: 12, border: '1px solid var(--border)' }}
            />
          </div>
          <div style={{ marginTop: 16 }}>
            <Countdown target={new Date(expiresAt).getTime()} labels={['Hrs', 'Min', 'Sec', '…']} />
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={() => void start()}>
            Generate a new code
          </button>
        </div>
      )}

      {phase === 'error' && (
        <p className="form-error" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}

      {phase !== 'pending' && (
        <button className="btn btn-primary" onClick={() => void start()} disabled={phase === 'creating'}>
          {phase === 'creating' ? 'Creating…' : 'Connect Telegram'}
        </button>
      )}
    </div>
  );
}
