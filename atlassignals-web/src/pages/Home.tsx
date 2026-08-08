/**
 * Home.tsx — landing page.
 *
 * The story sells the ENGINE: four timeframes reading gold like a
 * discretionary trader, liquidity intelligence, conviction tiers and a
 * validated backtest — not just delivery speed. No fake prices anywhere:
 * the hero visual and ticker use labeled placeholders (real signals are
 * RLS-gated and only visible to signed-in users).
 */
import { Link } from 'react-router-dom';
import Background from '../components/Background';
import Faq from '../components/Faq';
import Pricing from '../components/Pricing';
import Reveal from '../components/Reveal';
import Sparkline from '../components/Sparkline';
import Ticker from '../components/Ticker';
import { useAuth } from '../context/AuthContext';
import { getMarketInfo, useNow } from '../hooks/useMarket';
import {
  APP_NAME,
  BEHAVIORS,
  COMPANY_NAME,
  COMPANY_URL,
  LIQUIDITY_CONCEPTS,
  PERF,
  PLAN_LABEL,
  SESSION,
  TF_LAYERS,
  TIERS,
} from '../lib/site';

const STEPS = [
  {
    title: 'Create your account',
    text: 'Sign up with Google or email in seconds. Every new account gets a 24-hour free trial — sign up on a weekend and it starts when the market opens Monday.',
  },
  {
    title: 'Get every signal, live',
    text: 'Your dashboard updates in real time with direction, entry, stop loss, take profit, a confidence score and a conviction tier (A / B / C) for each approved setup.',
  },
  {
    title: 'Link Telegram (optional)',
    text: 'In Settings, tap the deep link and your chat is linked to your account. From then on, signals are pushed there the instant they are approved.',
  },
];

const FEATURES = [
  {
    icon: '🧠',
    title: 'Reads four timeframes at once',
    text: '4H sets the bias, 1H finds the level, 15M confirms the setup, 5M times the entry. No timeframe overrides another — they contribute weighted evidence.',
  },
  {
    icon: '🔍',
    title: 'Reads price behaviour, not indicators',
    text: 'Rejection, acceptance, momentum, exhaustion, compression, expansion — the engine scores what price actually did, normalised against history.',
  },
  {
    icon: '🎯',
    title: 'Liquidity intelligence',
    text: 'It hunts sweeps and reclaims — the pattern where price flushes the stops at a level and snaps back. The highest-quality trigger in the book.',
  },
  {
    icon: '🌊',
    title: 'Adapts to market regimes',
    text: 'Trending, squeezing, choppy, accelerating… the engine re-weights its evidence for the regime it detects. It adapts — it never trades on autopilot assumptions.',
  },
  {
    icon: '💎',
    title: 'Conviction tiers, sized honestly',
    text: 'Every signal carries a tier — A (full size), B (reduced) or C (minimum). Confidence drives position size continuously. No oversized gambles.',
  },
  {
    icon: '🛡️',
    title: 'Risk engineered in',
    text: 'Every stop loss and take profit is drawn from the market’s own structural levels — swing points, broken zones, prior highs/lows — plus volatility. No fixed-ratio guesses, which is why the levels are realistic and achievable.',
  },
];

export default function Home() {
  const { session } = useAuth();
  const now = useNow(60_000);
  const market = getMarketInfo(now);

  return (
    <>
      <Background />

      {/* ─── Hero ─────────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <Reveal>
              <span className="eyebrow">
                <span className="dot" /> XAU/USD · Four timeframes · One conviction
              </span>
              <h1>
                The engine that reads gold like a <span className="accent">discretionary trader.</span>
              </h1>
              <p className="hero-sub">
                {APP_NAME} doesn't fire off random alerts. It watches gold across four
                timeframes — asking the same questions a veteran trader asks — and only
                publishes a signal when the evidence genuinely aligns: direction, level,
                confirmation and timing.
              </p>
              <div className="hero-cta">
                <Link to={session ? '/dashboard' : '/auth?mode=signup'} className="btn btn-primary btn-lg">
                  {session ? 'Open dashboard' : 'Start free trial'} →
                </Link>
                <Link to="/method" className="btn btn-ghost btn-lg">
                  Inside the engine
                </Link>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <div className="hero-stats">
                <div className="stat">
                  <span className="num">
                    82.3<span className="u">%</span>
                  </span>
                  <span className="lbl">in-sample win rate*</span>
                </div>
                <div className="stat">
                  <span className="num">
                    72.2<span className="u">%</span>
                  </span>
                  <span className="lbl">out-of-sample*</span>
                </div>
                <div className="stat">
                  <span className="num">
                    15<span className="u">min</span>
                  </span>
                  <span className="lbl">full re-analysis cadence</span>
                </div>
              </div>
              <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
                *36 iterations of simulated refinement · ~6 years of XAU/USD data ·
                in-sample/out-of-sample split. Past performance is not a guarantee of future results.
              </p>
            </Reveal>
          </div>

          <Reveal delay={180}>
            <div className="signal-visual float-slow">
              <div className="glass">
                <div className="visual-toolbar">
                  <span className="badge badge-blue">
                    <span className="dot" /> DIRECTION
                  </span>
                  <span className="badge">XAU/USD · 15M</span>
                </div>
                <div className="visual-price placeholder-blur" style={{ fontSize: 22 }}>
                  PRICE
                </div>
                <div style={{ marginBlock: 10, opacity: 0.5 }}>
                  <Sparkline seed="hero-curve" up width={300} height={90} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
                  {['ENTRY', 'STOP', 'TARGET'].map((l) => (
                    <div key={l} className="glass" style={{ padding: '10px 8px', borderRadius: 10 }}>
                      <div className="dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        {l}
                      </div>
                      <div className="placeholder-blur" style={{ fontSize: 13, paddingTop: 4 }}>
                        PRICE
                      </div>
                    </div>
                  ))}
                </div>
                <div className="placeholder-blur" style={{ fontSize: 12 }}>
                  CONFIDENCE · REASON · ENGINE
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <Ticker />

      {/* ─── How the bot thinks (the four questions) ───────────────────── */}
      <section className="section" id="how-it-works">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <span className="eyebrow">How the bot thinks</span>
              <h2>Four timeframes. Four questions. One decision.</h2>
              <p>
                Every setup is scored across a hierarchy — each layer asks one question,
                and no layer can override the others. The engine only acts on a{' '}
                <strong className="green">closed candle</strong>, never an incomplete one.
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
            <div style={{ textAlign: 'center', marginTop: 26 }}>
              <Link to="/method" className="btn btn-ghost">
                Dive into the full engine →
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── What it reads ────────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 24 }} id="features">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <span className="eyebrow">What it reads</span>
              <h2>Price behaviour, scored like a pro</h2>
              <p>
                Instead of piling on indicators, the engine reads what price actually
                did — and what the people who traded those candles were probably doing.
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

      {/* ─── Liquidity intelligence ───────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 24 }}>
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <span className="eyebrow">Liquidity intelligence</span>
              <h2>It hunts the levels where money is trapped</h2>
              <p>
                Most retail setups fail at key levels — because that's exactly where the
                stops are. The engine looks for the moment those levels are swept.
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

      {/* ─── Conviction tiers ─────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 24 }}>
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <span className="eyebrow">Conviction tiers</span>
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
            <p className="dim" style={{ fontSize: 12.5, textAlign: 'center', marginTop: 12, maxWidth: 720, marginInline: 'auto' }}>
              {SESSION.hours} · {SESSION.cadence} · {SESSION.note}
            </p>
          </Reveal>
        </div>
      </section>

      {/* ─── Backtest band ────────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 24 }}>
        <div className="container">
          <Reveal>
            <div className="glass panel">
              <div className="section-head center" style={{ marginBottom: 28 }}>
                <span className="eyebrow">Validated, not vibes</span>
                <h2 style={{ fontSize: 'clamp(24px,3.6vw,36px)' }}>36 iterations. Two test periods. One honest split.</h2>
                <p>
                  {PERF.dataNote} The engine was tuned on in-sample data, then verified on
                  a holdout period it had never seen — no cherry-picking, no hindsight.
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
                {PERF.inSample.trades} filled trades in-sample ({PERF.inSample.mdd} max drawdown) ·{' '}
                {PERF.holdout.trades} filled trades out-of-sample ({PERF.holdout.mdd} max drawdown).
                Backtested performance does not guarantee future results — trading carries real risk.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── How to use it ────────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 24 }}>
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <span className="eyebrow">How to use it</span>
              <h2>Three steps to your first signal</h2>
            </div>
          </Reveal>
          <div className="steps">
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 80}>
                <div className="glass step-card hoverable">
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Market / weekend note ────────────────────────────────────── */}
      <section className="section" style={{ paddingBlock: 40 }}>
        <div className="container">
          <Reveal>
            <div className="glass panel" style={{ textAlign: 'center' }}>
              <h2 style={{ justifyContent: 'center' }}>
                {market.marketOpen ? (
                  <span className="badge badge-green">
                    <span className="dot" /> Market open
                  </span>
                ) : (
                  <span className="badge badge-gold">Market closed for the weekend</span>
                )}
              </h2>
              <p className="muted" style={{ maxWidth: 640, marginInline: 'auto' }}>
                The engine analyses gold continuously while the market is open ({SESSION.hours}).
                Sign up over the weekend and your 24-hour free trial starts when the market
                reopens — you never lose trial time to a closed market.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── Pricing ──────────────────────────────────────────────────── */}
      <section className="section" id="pricing">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <span className="eyebrow">Pricing</span>
              <h2>Simple, honest pricing</h2>
              <p>
                One plan. {PLAN_LABEL} after your free trial — activated automatically by
                Paystack, renewable monthly, cancel anytime.
              </p>
            </div>
          </Reveal>
          <Pricing />
        </div>
      </section>

      {/* ─── FAQ ──────────────────────────────────────────────────────── */}
      <section className="section" id="faq">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <span className="eyebrow">FAQ</span>
              <h2>Questions, answered</h2>
            </div>
          </Reveal>
          <Reveal>
            <Faq />
          </Reveal>
        </div>
      </section>

      {/* ─── CTA band ─────────────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 24 }}>
        <div className="container">
          <Reveal>
            <div className="glass panel" style={{ textAlign: 'center', padding: '44px 28px' }}>
              <h2 style={{ fontSize: 'clamp(26px,4vw,38px)', justifyContent: 'center' }}>
                Let the engine do the reading.
              </h2>
              <p className="muted" style={{ maxWidth: 520, margin: '10px auto 26px' }}>
                Try the full service free for 24 hours. No card required — just a
                market-ready signal, delivered the way a pro would read it.
              </p>
              <Link to={session ? '/dashboard' : '/auth?mode=signup'} className="btn btn-primary btn-lg">
                {session ? 'Open dashboard' : 'Start your free trial'} →
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
