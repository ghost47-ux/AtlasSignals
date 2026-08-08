/**
 * Method.tsx — "Inside the engine".
 *
 * The complete, user-facing explanation of how the bot thinks: the four
 * timeframes and their questions, the price behaviours it reads, liquidity
 * intelligence, conviction tiers, the validated backtest story, a beginner
 * playbook, and a glossary. All copy reads from site.ts so it can never
 * drift from the landing page or the support assistant.
 */
import { Link } from 'react-router-dom';
import Background from '../components/Background';
import Reveal from '../components/Reveal';
import {
  APP_NAME,
  BEHAVIORS,
  COMPANY_NAME,
  LIQUIDITY_CONCEPTS,
  PERF,
  REGIMES,
  SESSION,
  TF_LAYERS,
  TIERS,
} from '../lib/site';

const PLAYBOOK: { title: string; text: string }[] = [
  {
    title: 'One signal, one plan',
    text: 'Every signal ships with a defined entry, stop loss and take profit. Follow the plan as written — do not move the goalposts after the signal is live.',
  },
  {
    title: 'The stop loss is the contract',
    text: 'The engine derives stops and targets from market structure and ATR, not guesses. Honour the stop loss — it is the boundary of the risk you agreed to take.',
  },
  {
    title: 'Size by tier, not by feeling',
    text: 'Tier A = full size, Tier B = reduced, Tier C = minimum. Match your position to the engine’s own conviction — that is exactly how it sizes its own trades.',
  },
  {
    title: 'Use a trailing stop on winners',
    text: 'Once a position is in profit, a trailing stop protects it while letting the move run. Never widen a stop against the plan — trail only, never loosen.',
  },
  {
    title: 'Let the engine do its work',
    text: 'The engine re-evaluates the market at every 15-minute close with a full re-analysis. Don’t panic-close early because of noise — the plan already has its exit.',
  },
  {
    title: 'Compounding beats heroics',
    text: 'The edge lives in many small, disciplined wins — not one giant trade. Let the win rate and expectancy compound by being consistent.',
  },
];

const GLOSSARY: { term: string; text: string }[] = [
  {
    term: 'Sweep + Reclaim',
    text: 'Price dips through a key level (taking out the stops parked there) and snaps straight back inside. The engine’s highest-quality trigger.',
  },
  {
    term: 'Liquidity',
    text: 'The pool of resting orders (stops and limit entries) that price is drawn toward. Where institutions find counterparties.',
  },
  {
    term: 'PDH / PDL',
    text: 'Prior Day High / Prior Day Low — the most-watched intraday levels; the engine scores proximity to them into every setup.',
  },
  {
    term: 'Rejection',
    text: 'Price tries to break a level, fails, and leaves a wick. The engine reads who got trapped on the wrong side.',
  },
  {
    term: 'Acceptance',
    text: 'Price closing and holding beyond a broken level — not just touching it. Confirmation the move is real.',
  },
  {
    term: 'Compression',
    text: 'A squeeze: volatility collapsing into a coil. The engine treats it as stored energy, not quiet boredom.',
  },
  {
    term: 'Regime',
    text: 'The market’s current character (trending, choppy, accelerating…). The engine detects it and re-weights its evidence accordingly.',
  },
  {
    term: 'ATR',
    text: 'Average True Range — a measure of recent volatility. The engine uses it to size stops and targets around structure.',
  },
  {
    term: 'Confidence score',
    text: 'A 0–100 reading of how much evidence the four timeframes produced for a setup. Drives the tier and position size.',
  },
  {
    term: 'Setup',
    text: 'A complete, tradeable opportunity: direction, entry, stop, target, with the engine’s conviction attached.',
  },
];

export default function Method() {
  return (
    <>
      <Background />

      {/* ─── Hero ─────────────────────────────────────────────────────── */}
      <section className="hero" style={{ minHeight: 'auto', paddingBottom: 40 }}>
        <div className="container">
          <Reveal>
            <div style={{ maxWidth: 760 }}>
              <span className="eyebrow">
                <span className="dot" /> Inside the engine
              </span>
              <h1 style={{ fontSize: 'clamp(34px, 5.4vw, 58px)' }}>
                How the bot actually <span className="accent">thinks</span>.
              </h1>
              <p className="hero-sub" style={{ maxWidth: 620 }}>
                {APP_NAME} isn’t a script that shouts “buy gold”. It is a multi-timeframe
                analysis engine that reads gold the way a disciplined discretionary trader
                would — then publishes only the setups where the evidence genuinely
                aligns. Here is exactly how it works.
              </p>
              <div className="hero-cta">
                <Link to="/auth?mode=signup" className="btn btn-primary btn-lg">
                  Try the engine free →
                </Link>
                <Link to="/#pricing" className="btn btn-ghost btn-lg">
                  See pricing
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── The four questions ───────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 48 }} id="timeframes">
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="eyebrow">01 · The hierarchy</span>
              <h2>Four timeframes. Four questions. One decision.</h2>
              <p>
                Every setup is scored across a strict hierarchy. Each layer asks one
                question — and no layer can override the others. The engine only acts on
                a <strong className="green">closed candle</strong>, never an incomplete
                one, and never on a single timeframe alone.
              </p>
            </div>
          </Reveal>
          <div className="tf-grid">
            {TF_LAYERS.map((t, i) => (
              <Reveal key={t.tf} delay={i * 70}>
                <div className="glass tf-card hoverable">
                  <span className="tf-weight">{t.weight}</span>
                  <span className="tf-chip">{t.tf}</span>
                  <div className="tf-role">{t.role}</div>
                  <h3>“{t.question}”</h3>
                  <p>{t.blurb}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal>
            <p className="dim" style={{ fontSize: 13, marginTop: 18, maxWidth: 680 }}>
              The weight column is how much each layer contributes to the final score.
              Notice what the 4H can never do: generate entries. Bias guides, structure
              locates, confirmation filters, precision times.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ─── Behaviours ───────────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 24 }}>
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="eyebrow">02 · What it reads</span>
              <h2>Price behaviour, scored like a pro</h2>
              <p>
                Instead of piling on lagging indicators, the engine reads what price
                actually did — and what the traders who made those candles were
                probably doing.
              </p>
            </div>
          </Reveal>
          <div className="behavior-grid">
            {BEHAVIORS.map((b, i) => (
              <Reveal key={b.name} delay={i * 50}>
                <div className="glass behavior-card hoverable">
                  <div className="b-icon">{b.emoji}</div>
                  <h4>{b.name}</h4>
                  <p>{b.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Liquidity ────────────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 24 }}>
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="eyebrow">03 · Liquidity intelligence</span>
              <h2>It hunts the levels where money is trapped</h2>
              <p>
                Most retail setups fail at key levels — because that’s exactly where the
                stops are. The engine watches for the moment those levels are swept.
              </p>
            </div>
          </Reveal>
          <div className="feature-grid">
            {LIQUIDITY_CONCEPTS.map((c, i) => (
              <Reveal key={c.name} delay={i * 60}>
                <div className="glass feature-card hoverable">
                  <div className="icon">💧</div>
                  <h3>{c.name}</h3>
                  <p>{c.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Regimes ──────────────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 24 }}>
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="eyebrow">04 · Regime awareness</span>
              <h2>It adapts to the market’s mood</h2>
              <p>
                A strategy that wins in a trend can bleed in a chop. The engine detects
                the market’s current regime and re-weights its evidence — it adapts, it
                never trades on autopilot assumptions.
              </p>
            </div>
          </Reveal>
          <Reveal>
            <div className="glass panel" style={{ padding: '22px 24px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {REGIMES.map((r) => (
                  <span key={r} className="badge badge-blue">{r}</span>
                ))}
              </div>
              <p className="dim" style={{ fontSize: 13, marginTop: 14 }}>
                Regimes adjust <em>weights</em>, never decisions. The engine can’t be
                talked out of a high-conviction setup — but it reads the context honestly.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── Tiers ────────────────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 24 }}>
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="eyebrow">05 · Conviction tiers</span>
              <h2>Every signal is graded — and sized honestly</h2>
              <p>
                No blanket “BUY GOLD” alerts. Each signal scores 0–1 and carries a tier
                that tells you exactly how much conviction the engine has — and how it
                sizes its own positions.
              </p>
            </div>
          </Reveal>
          {TIERS.map((t, i) => (
            <Reveal key={t.tier} delay={i * 60}>
              <div className="glass tier-row" style={{ padding: 18 }}>
                <div className={`tier-badge ${t.tier}`}>{t.tier}</div>
                <div className="tier-info">
                  <h4>{t.label}</h4>
                  <div className="tags">
                    <span className="badge">{t.score}</span>
                    <span className="badge badge-green">{t.size}</span>
                  </div>
                  <p>{t.text}</p>
                </div>
              </div>
            </Reveal>
          ))}
          <Reveal>
            <p className="dim" style={{ fontSize: 12.5, marginTop: 12 }}>
              {SESSION.hours} · {SESSION.cadence} · {SESSION.note}
            </p>
          </Reveal>
        </div>
      </section>

      {/* ─── Backtest ─────────────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 24 }}>
        <div className="container">
          <Reveal>
            <div className="glass panel">
              <div className="section-head" style={{ marginBottom: 28 }}>
                <span className="eyebrow">06 · Validated, not vibes</span>
                <h2 style={{ fontSize: 'clamp(24px,3.6vw,36px)' }}>
                  {PERF.iterations} iterations. Two test periods. One honest split.
                </h2>
                <p>
                  {PERF.dataNote} The engine was tuned on in-sample data, then verified
                  on a holdout period it had never seen — no cherry-picking, no
                  hindsight bias.
                </p>
              </div>
              <div className="stat-band">
                <div className="stat-cell">
                  <span className="v">{PERF.inSample.winRate}</span>
                  <span className="l">Win rate · in-sample</span>
                </div>
                <div className="stat-cell">
                  <span className="v">{PERF.inSample.expectancy}</span>
                  <span className="l">Expectancy · in-sample</span>
                </div>
                <div className="stat-cell">
                  <span className="v">{PERF.holdout.winRate}</span>
                  <span className="l">Win rate · holdout</span>
                </div>
                <div className="stat-cell">
                  <span className="v">{PERF.iterations}</span>
                  <span className="l">Iterations of refinement</span>
                </div>
              </div>
              <p className="stat-note">
                {PERF.inSample.trades} filled trades in-sample ({PERF.inSample.mdd} max
                drawdown) · {PERF.holdout.trades} filled trades out-of-sample (
                {PERF.holdout.mdd} max drawdown). Backtested performance does not
                guarantee future results — trading carries real risk.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── Playbook ─────────────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 24 }}>
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="eyebrow">07 · The playbook</span>
              <h2>How to use the signals</h2>
              <p>
                The engine handles the analysis. These are the habits that let its edge
                actually compound in your account.
              </p>
            </div>
          </Reveal>
          <div className="feature-grid">
            {PLAYBOOK.map((p, i) => (
              <Reveal key={p.title} delay={i * 50}>
                <div className="glass feature-card hoverable">
                  <div className="icon">📋</div>
                  <h3>{p.title}</h3>
                  <p>{p.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Glossary ─────────────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 24 }}>
        <div className="container">
          <Reveal>
            <div className="section-head">
              <span className="eyebrow">08 · The vocabulary</span>
              <h2>Terms you’ll see in every signal</h2>
              <p>Ten terms that decode 90% of what the engine talks about.</p>
            </div>
          </Reveal>
          <div className="glossary">
            {GLOSSARY.map((g, i) => (
              <Reveal key={g.term} delay={i * 30}>
                <div className="gloss-item">
                  <span className="term">{g.term}</span>
                  <p>{g.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ──────────────────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 24 }}>
        <div className="container">
          <Reveal>
            <div className="glass panel" style={{ textAlign: 'center', padding: '44px 28px' }}>
              <h2 style={{ fontSize: 'clamp(26px,4vw,38px)', justifyContent: 'center' }}>
                See the engine in action.
              </h2>
              <p className="muted" style={{ maxWidth: 520, margin: '10px auto 26px' }}>
                Try the full service free for 24 hours. No card required — just watch a
                real setup get scored across all four timeframes.
              </p>
              <div className="hero-cta" style={{ justifyContent: 'center', marginBottom: 0 }}>
                <Link to="/auth?mode=signup" className="btn btn-primary btn-lg">
                  Start your free trial →
                </Link>
              </div>
              <p className="dim" style={{ fontSize: 12, marginTop: 18 }}>
                {APP_NAME} is a product of {COMPANY_NAME}.
              </p>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
