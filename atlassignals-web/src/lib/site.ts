/**
 * site.ts — single source of truth for site-wide configuration and the
 * engine "story" (how the bot thinks). Marketing copy across the landing
 * page, the Method page and the support assistant reads from here so they
 * can never drift apart.
 *
 * The numbers below are the engine's own backtest results (see the HF Space
 * config: in-sample / holdout split, 36 iterations of refinement).
 */

const env = import.meta.env;

/** Deployed backend (relay) base URL — the browser calls /payments/initialize
 *  and /telegram/link here with the user's Supabase JWT. */
export const RELAY_BASE: string = env.VITE_RELAY_BASE || 'https://atlassignals-relay.vercel.app';

/** Canonical public site URL (SEO canonical + OAuth redirect base). */
export const SITE_URL: string = env.VITE_SITE_URL || 'https://atlassignals-web.vercel.app';

/** Telegram bot the site links accounts to. */
export const TELEGRAM_BOT_USERNAME: string = env.VITE_TELEGRAM_BOT_USERNAME || 'Atlas_sign_albot';
export const TELEGRAM_BOT_LINK = (code: string): string =>
  `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${encodeURIComponent(code)}`;

/** Pricing (mirrors PAYSTACK_PLAN_AMOUNT on the backend: 1000000 kobo = ₦10,000). */
export const PLAN_AMOUNT_MAJOR: number = Number(env.VITE_PLAN_AMOUNT_MAJOR || 10000);
export const PLAN_CURRENCY: string = env.VITE_PLAN_CURRENCY || 'NGN';
export const PLAN_LABEL = `₦${PLAN_AMOUNT_MAJOR.toLocaleString('en-NG')}/${PLAN_CURRENCY}/month`;

/** Support contact surfaced in the chatbot + footer. */
export const CONTACT_EMAIL: string = env.VITE_CONTACT_EMAIL || 'support@atlassignals.com';

/** Company behind the project. */
export const COMPANY_NAME = 'Atlas Digital Systems';
export const COMPANY_URL = 'https://atlas-digital-systems.lovable.app/';

export const APP_NAME = 'AtlasSignals';
export const APP_TAGLINE = 'The analysis engine that reads gold like a discretionary trader.';

export interface NavLink {
  label: string;
  href: string;
}

export const NAV_LINKS: NavLink[] = [
  { label: 'Features', href: '/#features' },
  { label: 'Inside the engine', href: '/method' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'FAQ', href: '/#faq' },
];

/* ─── The engine, in marketing terms ─────────────────────────────────────── */

/** The four timeframes and the question each one answers. */
export const TF_LAYERS: {
  tf: string;
  role: string;
  question: string;
  weight: string;
  blurb: string;
  canEntry: boolean;
}[] = [
  {
    tf: '4H',
    role: 'Context',
    question: 'What is the market trying to do?',
    weight: '30%',
    blurb:
      'The dominant trend and major swing structure. It sets the bias — and it never generates entries. If the 4H says bearish with conviction, the engine will not fight it.',
    canEntry: false,
  },
  {
    tf: '1H',
    role: 'Setup',
    question: 'Where is the best opportunity?',
    weight: '35%',
    blurb:
      'The primary analysis surface. Break of structure, pullback quality and the exact structural level where the opportunity lives.',
    canEntry: false,
  },
  {
    tf: '15M',
    role: 'Confirmation',
    question: 'Is the setup actually forming?',
    weight: '25%',
    blurb:
      'Where the engine looks for momentum returning, rejection wicks and liquidity sweeps. This layer exists to kill false positives before they reach you.',
    canEntry: true,
  },
  {
    tf: '5M',
    role: 'Precision',
    question: 'Is now a good moment?',
    weight: '10%',
    blurb:
      'Micro-structure and immediate pressure. It refines timing but can never override the higher timeframes.',
    canEntry: false,
  },
];

/** The behavioral readings the engine makes on price action. */
export const BEHAVIORS: { name: string; emoji: string; text: string }[] = [
  {
    name: 'Rejection',
    emoji: '🛑',
    text: 'Price tried to move a direction, failed, and left a wick. The engine reads who got trapped.',
  },
  {
    name: 'Acceptance',
    emoji: '✅',
    text: 'Price holding above or below a broken level — not just touching it, accepting it.',
  },
  {
    name: 'Momentum',
    emoji: '⚡',
    text: 'Is the move accelerating or fading? Directional displacement, normalised against history.',
  },
  {
    name: 'Exhaustion',
    emoji: '🪫',
    text: 'The fuel running out. The engine prefers the end of a counter-move, not the start.',
  },
  {
    name: 'Compression',
    emoji: '🌀',
    text: 'A coiled squeeze. Bollinger width collapses — energy building for a breakout.',
  },
  {
    name: 'Expansion',
    emoji: '🚀',
    text: 'The release. A full-bodied, decisive move with the range expanding.',
  },
];

/** Liquidity concepts (smart-money framing, all real engine terms). */
export const LIQUIDITY_CONCEPTS: { name: string; text: string }[] = [
  {
    name: 'Sweep + Reclaim',
    text: 'The engine’s most important pattern: price sweeps a key level (flushing the stops sitting there) and snaps straight back. In the data, this is the highest-quality trigger in the book.',
  },
  {
    name: 'Trap detection',
    text: 'A breakout that fails — price breaks a level and closes back inside. The engine treats it as a trap, not a breakout.',
  },
  {
    name: 'Prior day high / low',
    text: 'The levels every intraday trader watches. Proximity to PDH/PDL is scored into every setup.',
  },
  {
    name: 'Equal highs & lows',
    text: 'Clusters of equal levels are magnets for liquidity — the engine watches them for sweeps.',
  },
];

/** Conviction tiers. Thresholds + sizing are the engine’s real values. */
export const TIERS: { tier: string; score: string; label: string; size: string; text: string }[] = [
  {
    tier: 'A',
    score: '≥ 0.70 score',
    label: 'High conviction',
    size: 'Full position size',
    text: 'All four timeframes aligned, structure clean, and a high-quality trigger (usually a sweep + reclaim). This is the trade the engine is built for.',
  },
  {
    tier: 'B',
    score: '≥ 0.55 score',
    label: 'Moderate conviction',
    size: 'Reduced position size',
    text: 'A solid setup with one layer less than perfect. Still worth taking — with size calibrated to match.',
  },
  {
    tier: 'C',
    score: '≥ 0.40 score',
    label: 'Minimum conviction',
    size: 'Minimum position size',
    text: 'The market is readable, not perfect. The engine trades it small or stays out entirely.',
  },
];

/** Regimes the engine adapts to (regime adjusts weights — it never blocks). */
export const REGIMES: string[] = [
  'Trending',
  'Retracement in trend',
  'Compression squeeze',
  'Balanced rotation',
  'Choppy whipsaw',
  'Liquidity grab',
  'Expansion initiation',
  'Accelerating',
  'Decelerating / exhausting',
  'Regime shift',
  'Resumption',
];

/** Backtest validation (the engine’s own numbers — user-supplied, real). */
export const PERF: {
  dataNote: string;
  inSample: { label: string; trades: number; winRate: string; expectancy: string; mdd: string };
  holdout: { label: string; trades: number; winRate: string; mdd: string };
  iterations: number;
} = {
  dataNote: 'Developed and validated across roughly six years of XAU/USD historical OHLCV data.',
  inSample: {
    label: 'In-sample (18 months)',
    trades: 361,
    winRate: '82.3%',
    expectancy: '7.2R',
    mdd: '17%',
  },
  holdout: {
    label: 'Out-of-sample holdout (6 months)',
    trades: 133,
    winRate: '72.2%',
    mdd: '≈20%',
  },
  iterations: 36,
};

/** Trading session facts (real engine behavior — continuous, rolling windows). */
export const SESSION = {
  hours: 'Mon–Fri · market open → close',
  cadence: 'Re-analysis every 15 minutes',
  note: 'Analysis runs continuously from the moment the market opens until it closes, over rolling context windows across every timeframe. At the close of every 15-minute bar the full context engine re-runs and selects the best trade through its decision logic.',
};

export const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'What is AtlasSignals?',
    a: 'AtlasSignals is a XAU/USD (gold) signal service built around a four-timeframe analysis engine. It reads the market the way a disciplined discretionary trader would — then packages its highest-conviction setup with entry, stop loss and take profit, delivered straight to your dashboard and Telegram.',
  },
  {
    q: 'How does the bot actually analyze the market?',
    a: 'Four timeframes, four questions. The 4H answers “what is the market trying to do?” (bias, never an entry), the 1H answers “where is the best opportunity?” (structure and levels), the 15M answers “is the setup actually forming?” (momentum, rejection, sweeps), and the 5M answers “is now a good moment?” (timing). No timeframe overrides another — they contribute weighted evidence, and the engine only acts on a closed candle, never an incomplete one.',
  },
  {
    q: 'What are signal tiers A, B and C?',
    a: 'Every signal is scored 0–1 and placed in a conviction tier. Tier A (score ≥ 0.70) is high conviction — full position size, usually with a liquidity sweep + reclaim trigger. Tier B (≥ 0.55) is moderate — reduced size. Tier C (≥ 0.40) is minimum size. The engine only publishes when the market is genuinely readable — silence is a signal too.',
  },
  {
    q: 'What is the win rate?',
    a: 'The engine was refined across 36 iterations of simulated backtesting on roughly six years of XAU/USD data, with a strict in-sample / out-of-sample split. In-sample: 82.3% win rate across 361 trades (7.2R expectancy, 17% max drawdown). Out-of-sample holdout on data the engine never saw during tuning: 72.2% across 133 trades. Past performance — simulated or live — never guarantees future results.',
  },
  {
    q: 'When are signals generated?',
    a: 'The engine analyses gold continuously from the moment the market opens until it closes (Monday–Friday), maintaining rolling context windows across every timeframe. At the close of every 15-minute bar it re-runs the full context engine and selects the best trade through its decision logic. Sign up over the weekend and your 24-hour free trial starts when the market opens on Monday — so you never waste trial time on a closed market.',
  },
  {
    q: 'What is the free trial and pricing?',
    a: 'Every new account gets 24 hours of full access at no cost. Paid access is ₦10,000/month (NGN), activated automatically by Paystack the moment your payment confirms. Renewals simply extend your window.',
  },
  {
    q: 'How do I get signals on Telegram?',
    a: 'Sign in to the website, open Settings → Connect Telegram, and tap the generated deep link. The bot links that chat to your account and every approved signal is delivered there instantly. Unlinked chats receive nothing — a random person typing /start only gets instructions.',
  },
  {
    q: 'How should I use the signals?',
    a: 'Every signal ships with a defined entry, stop loss and take profit — treat the stop loss as non-negotiable. Size positions by tier (A full, B reduced, C minimum) and per your own risk rules. A trailing stop can protect winners, but never widen a stop against the plan. One signal, one plan, discipline — that is the whole playbook.',
  },
  {
    q: 'Is this financial advice?',
    a: 'No. Signals are informational output of an automated analysis engine. Trading involves substantial risk of loss. Always do your own analysis and never risk money you cannot afford to lose. AtlasSignals is a product of Atlas Digital Systems.',
  },
];
