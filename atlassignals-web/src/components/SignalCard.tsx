/**
 * SignalCard.tsx — one signal row: direction, levels, confidence, meta.
 */
import { fmtDateTime, fmtPrice, timeAgo } from '../lib/format';
import { signalTier, type SignalRow } from '../lib/supabase';
import Sparkline from './Sparkline';

/** Tier badge (A/B/C) — colored by conviction, mirroring the site's tier system. */
function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      className={`badge tier-chip ${tier}`}
      title={tier === 'A' ? 'High conviction — full size' : tier === 'B' ? 'Moderate conviction — reduced size' : 'Minimum conviction — minimum size'}
    >
      Tier {tier}
    </span>
  );
}

export default function SignalCard({ signal, compact = false }: { signal: SignalRow; compact?: boolean }) {
  const up = signal.direction === 'BUY';
  const tier = signalTier(signal);
  return (
    <div className="glass signal-card hoverable">
      <div className={`signal-dir ${signal.direction}`}>
        {signal.direction === 'BUY' ? '▲ BUY' : '▼ SELL'}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>
            {signal.symbol}
          </strong>
          <span className="badge">{signal.timeframe}</span>
          <span className="badge badge-blue">{signal.setup_name}</span>
          {tier && <TierBadge tier={tier} />}
          <span className="mono dim" style={{ fontSize: 12 }}>
            {fmtDateTime(signal.created_at)} · {timeAgo(signal.created_at)}
          </span>
        </div>

        <div className="signal-meta">
          <span className="badge">
            Entry <span className={up ? 'green' : 'danger'}>{fmtPrice(signal.entry)}</span>
          </span>
          <span className="badge">
            SL <span className="danger">{fmtPrice(signal.stop_loss)}</span>
          </span>
          <span className="badge">
            TP <span className="green">{fmtPrice(signal.take_profit)}</span>
          </span>
          <span className="badge">
            Confidence <span className="cyan">{signal.confidence}/100</span>
          </span>
        </div>

        {!compact && (
          <div style={{ marginTop: 12 }}>
            <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${signal.confidence}%`,
                  height: '100%',
                  background: `linear-gradient(90deg, ${up ? '#00c97e' : '#ff5c7a'}, ${up ? '#00ffa3' : '#ff8fa5'})`,
                  boxShadow: `0 0 12px ${up ? 'rgba(0,255,163,0.5)' : 'rgba(255,92,122,0.5)'}`,
                  borderRadius: 4,
                }}
              />
            </div>
            <div className="dim mono" style={{ fontSize: 12, marginTop: 6 }}>
              {signal.market_state} · engine {signal.analysis_version}
            </div>
          </div>
        )}
      </div>

      <div className="signal-prices">
        <Sparkline seed={signal.signal_id} up={up} width={110} height={40} />
        <span className="p-entry">{fmtPrice(signal.entry)}</span>
      </div>
    </div>
  );
}
