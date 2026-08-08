/**
 * Ticker.tsx — decorative scrolling tape for the landing page.
 *
 * Signals are RLS-gated (never public), so this strip shows labeled
 * placeholders — never fabricated prices. The real-time tape lives inside
 * the signed-in dashboard.
 */
const SAMPLES: { tag: string; label: string }[] = [
  { tag: 'DIRECTION', label: 'SYMBOL' },
  { tag: 'PRICE', label: 'TIME' },
  { tag: 'REASON', label: 'CONFIDENCE' },
  { tag: 'TIER', label: 'SETUP' },
];

export default function Ticker() {
  const items = [...SAMPLES, ...SAMPLES, ...SAMPLES, ...SAMPLES, ...SAMPLES, ...SAMPLES];
  return (
    <div className="ticker" aria-hidden>
      <div className="ticker-track">
        {items.map((s, i) => (
          <span className="ticker-item" key={i}>
            <span className="badge badge-blue">{s.tag}</span>
            <span className="dim">{s.label}</span>
            <span className="dim">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}
