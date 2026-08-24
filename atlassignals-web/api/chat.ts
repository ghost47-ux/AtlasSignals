/**
 * api/chat.ts — agentic support assistant (Vercel serverless).
 *
 * The assistant answers questions about AtlasSignals from a knowledge base and
 * can take *actions* through tool calling (navigate to pricing, start the
 * Telegram linking flow, open checkout). It never touches user data — the
 * frontend executes the returned action with the user's own session.
 *
 * Env: GROQ_API_KEY (server-side only).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const MODEL = 'qwen/qwen3.6-27b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

type ChatRole = 'system' | 'user' | 'assistant' | 'tool';
interface ChatMsg {
  role: ChatRole;
  content: string | null;
  name?: string;
  tool_calls?: unknown;
  tool_call_id?: string;
}
interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are the AtlasSignals support assistant — helpful, concise, precise. You know everything about the product below. Always answer in the same language the user writes in. Never invent prices, features or policies beyond this knowledge base.

# Product knowledge
- AtlasSignals delivers XAU/USD (gold) trading signals produced by a multi-timeframe opportunity-scoring analysis engine. The engine analyses on our servers; the backend is the source of truth; the website is the dashboard + payment surface; Telegram is a notification extension of the dashboard.
- Every signal includes: symbol (XAU/USD), direction (BUY/SELL), timeframe (15M), entry, stop loss, take profit, confidence score (0-100), setup name, market state, and the engine version. Full mechanics are explained on the /method page ("Inside the engine").
- How the engine thinks: four timeframes each answer one question — 4H sets the bias (never entries), 1H finds the structure/level, 15M confirms the setup (momentum, rejection, sweeps), 5M times the entry. No timeframe overrides another; evidence is weighted (4H 30%, 1H 35%, 15M 25%, 5M 10%). It acts only on closed candles, never incomplete ones.
- It reads price behaviour (rejection, acceptance, momentum, exhaustion, compression, expansion) and hunts liquidity patterns — the most important being sweep + reclaim: price sweeps a key level (flushing stops) and snaps back. It adapts to market regimes by re-weighting evidence.
- Conviction tiers: every signal scores 0–1. Tier A (≥0.70) = high conviction, full position size, usually a sweep+reclaim trigger. Tier B (≥0.55) = moderate, reduced size. Tier C (≥0.40) = minimum size. Size by tier.
- Backtest validation: refined over 36 iterations of simulated backtesting on roughly six years of XAU/USD historical data with a strict in-sample / out-of-sample split. In-sample: 82.3% win rate across 361 trades, 7.2R expectancy, 17% max drawdown. Out-of-sample holdout (data never seen during tuning): 72.2% across 133 trades, ~20% max drawdown. Always add that past performance does not guarantee future results.
- Session: the engine analyses gold continuously from the moment the market opens until it closes (Monday–Friday), maintaining rolling context windows across every timeframe. At the close of every 15-minute bar it re-runs the full context engine and selects the best trade through its decision logic. Stop loss and take profit are not guessed from a fixed ratio — they are drawn from the market's own structural levels, so they are realistic and achievable.
- Signals are generated Monday-Friday only (market hours). None on weekends.
- Delivery is sub-second: a signal is written to the database and pushed to linked Telegram chats immediately; the dashboard live-updates via Realtime.
- Free trial: 24 hours of full access for every new account. If the user signs up on Saturday or Sunday, the 24h trial starts when the market opens on Monday — it never burns on a closed market.
- Pro plan: NGN 10,000 (₦10,000) per month, paid via Paystack (card / bank transfer etc). Payment is activated automatically by a verified Paystack webhook; the user does not need to contact anyone after paying. Renewals extend from the current window.
- Account linking (Telegram): user signs up/logs in on the website → Settings → Connect Telegram → taps the generated deep link (t.me/Atlas_sign_albot?start=CODE). The bot webhook links that chat to the account. After linking, every approved signal is delivered to that chat instantly. Unlinked chats receive NOTHING — a random person typing /start to the bot is directed to the website to sign up, they get no signals.
- Stops and targets: every SL/TP is derived from the market's structural levels (swings, break points, prior highs/lows) plus volatility — not a fixed ratio. That's why they are realistic and achievable.
- The support assistant can also help on Telegram: /start and /help.
- Access model: free_trial / paid / admin, enforced by the database at query time. Expired trials/payments simply stop receiving signals until upgraded.
- Beginner guidance: follow each signal's plan as written; treat the stop loss as non-negotiable; size positions by tier; a trailing stop protects winners but never widen a stop against the plan; consistency compounds.
- AtlasSignals is a product of Atlas Digital Systems (atlas-digital-systems.lovable.app).
- Support email: support@atlassignals.com. Trading disclaimer: not financial advice; trading involves substantial risk.

# Tools
You have tools to take actions. Use them when the user asks for the corresponding action:
1. navigate_to(page) — when the user asks to see pricing, features, FAQ, sign up, log in, or go to their dashboard/settings, or asks how the engine/bot works. Pages: "features", "method", "pricing", "faq", "signup", "login", "dashboard", "settings".
2. link_telegram() — when the user wants to connect/link their Telegram. If the context says they are not signed in, tell them they must sign up/log in first (do NOT call the tool).
3. start_checkout() — when the user wants to upgrade/pay/subscribe. Only call if signed in; otherwise tell them to log in first.

# Style
- Be short: 2-4 sentences normally. Use plain text, a few line breaks, no markdown tables.
- When the user requests an ACTION (seeing pricing/features/FAQ, signing up, logging in, opening dashboard or settings, linking Telegram, upgrading/paying), you MUST call the matching tool instead of describing the action in prose. Tool calls are how the website navigates for the user.
- If you call a tool, follow up with a one-line confirmation like "Opening the pricing page for you." and let the frontend perform the navigation.
- If the user asks something outside your knowledge, be honest and point them to support@atlassignals.com.`;

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface GroqChoice {
  message: {
    content?: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason?: string;
}

interface GroqResult {
  ok: boolean;
  choice?: GroqChoice | null;
  reason?: string;
  detail?: string;
}

async function groqCompletion(
  messages: ChatMsg[],
  toolChoice: unknown,
  withTools = true,
): Promise<GroqResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, reason: 'no_key' };
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      ...(withTools ? { tools: TOOLS, tool_choice: toolChoice } : {}),
      temperature: 0.35,
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    console.error('groq upstream error', res.status, detail);
    return { ok: false, reason: `upstream_${res.status}`, detail };
  }
  const data = (await res.json()) as { choices?: GroqChoice[] };
  return { ok: true, choice: data.choices?.[0] ?? null };
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'navigate_to',
      description:
        'Navigate the user to a page on the AtlasSignals website (features, method, pricing, faq, signup, login, dashboard, settings).',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            enum: ['features', 'method', 'pricing', 'faq', 'signup', 'login', 'dashboard', 'settings'],
          },
        },
        required: ['page'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'link_telegram',
      description:
        'Start the Telegram linking flow for a signed-in user (opens Settings → Connect Telegram). Only call when the user is signed in.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_checkout',
      description:
        'Start the Paystack checkout (upgrade to Pro). Only call when the user is signed in.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

/** Does this message look like an action request? (forces a tool call) */
export function hasActionIntent(message: string): boolean {
  return /(pricing|price|plans?|upgrade|pay|subscribe|checkout|sign\s?up|register|create\s?account|log\s?in|sign\s?in|dashboard|settings|telegram|connect|faq|questions|features|how\s?it\s?works|how\s?.*(bot|engine|works?)|inside\s?the\s?engine|method|open|go\s?to|take\s?me)/i.test(
    message,
  );
}

/**
 * Last-resort action extraction from a plain-text reply, so an action the
 * model described in prose still executes. Priority-ordered.
 */
export function extractProseAction(reply: string, signedIn: boolean): { type: string; to?: string } | null {
  const r = reply.toLowerCase();
  const has = (re: RegExp) => re.test(r);
  if (signedIn && has(/(upgrade|checkout|pay|subscribe|buy|purchase)/)) {
    return { type: 'start_checkout' };
  }
  if (has(/telegram|connect.*telegram|link.*telegram/)) {
    return { type: 'link_telegram' };
  }
  if (has(/how\s?.*(bot|engine|works?)|inside\s?the\s?engine|\bmethod\b/)) {
    return { type: 'navigate', to: '/method' };
  }
  if (has(/pricing|price|plans?/)) return { type: 'navigate', to: '/#pricing' };
  if (has(/sign\s?up|register|create\s?account|start.*trial/)) return { type: 'navigate', to: '/auth?mode=signup' };
  if (has(/log\s?in|sign\s?in/)) return { type: 'navigate', to: '/auth?mode=login' };
  if (has(/dashboard/)) return { type: 'navigate', to: '/dashboard' };
  if (has(/settings/)) return { type: 'navigate', to: '/settings' };
  if (has(/faq|questions/)) return { type: 'navigate', to: '/#faq' };
  if (has(/features|how\s?it\s?works/)) return { type: 'navigate', to: '/#features' };
  return null;
}

/** Strip raw tool-call echoes like navigate_to("pricing") or <function=...> from replies. */
export function cleanReply(text: string): string {
  return text
    .replace(/\bnavigate_to\s*\(\s*(?:page\s*=\s*)?["']?[a-z_]+["']?\s*\)/gi, '')
    .replace(/\b(?:link_telegram|start_checkout)\s*\(\s*\)/gi, '')
    .replace(/<function=\s*[a-z_]+[^>]*>\s*<\/function>/gi, '')
    .replace(/<\/?function[^>]*>/gi, '')
    .replace(/[\n\r]{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const PAGE_ROUTE: Record<string, string> = {
  features: '/#features',
  method: '/method',
  pricing: '/#pricing',
  faq: '/#faq',
  signup: '/auth?mode=signup',
  login: '/auth?mode=login',
  dashboard: '/dashboard',
  settings: '/settings',
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const { message, history, user } = (req.body ?? {}) as {
    message?: unknown;
    history?: HistoryTurn[];
    user?: { signedIn?: boolean; plan?: string; email?: string };
  };

  if (typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'empty_message' });
    return;
  }
  const trimmed = message.trim().slice(0, 2000);
  const historySlice: HistoryTurn[] = Array.isArray(history)
    ? history.filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string').slice(-8)
    : [];

  const signedIn = Boolean(user?.signedIn);
  const contextLine = signedIn
    ? `The user is signed in (plan: ${user?.plan ?? 'unknown'}; email: ${user?.email ?? 'unknown'}).`
    : 'The user is NOT signed in.';

  const messages: ChatMsg[] = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n# Current context\n${contextLine}` },
    ...historySlice.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: trimmed },
  ];

  try {
    const intent = hasActionIntent(trimmed);
    // 'required' on action intents forces a valid tool call — the model cannot
    // dodge into prose, which is what caused earlier tool_use_failed rounds.
    let first = await groqCompletion(messages, intent ? 'required' : 'auto');
    if (!first.ok) {
      // Tool round failed (e.g. malformed tool JSON) — fall back to a plain
      // answer so the user is never left without a reply. Actions are best-effort.
      console.error('assistant tool round failed:', first.reason, first.detail ?? '');
      const plain = await groqCompletion(messages, undefined, false);
      if (!plain.ok) {
        res.status(503).json({ error: 'assistant_unavailable', reason: plain.reason });
        return;
      }
      const fallbackReply = cleanReply(plain.choice?.message.content ?? '…');
      res.status(200).json({
        reply: fallbackReply,
        action: intent ? extractProseAction(fallbackReply, signedIn) : null,
      });
      return;
    }

    const toolCalls = first.choice?.message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      const reply = cleanReply(first.choice?.message.content ?? '…');
      res.status(200).json({
        reply,
        action: intent ? extractProseAction(reply, signedIn) : null,
      });
      return;
    }

    // Execute tools (frontend performs the actual navigation) and let the
    // model summarize in a second round.
    const actionMap: Record<string, { type: string; to?: string }> = {};
    const toolMessages: ChatMsg[] = [];
    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        args = {};
      }
      const name = tc.function.name;
      let result: Record<string, unknown>;
      if (name === 'navigate_to') {
        const page = String(args.page ?? '');
        result = PAGE_ROUTE[page] ? { ok: true, page } : { ok: false, reason: 'unknown_page' };
        if (PAGE_ROUTE[page]) actionMap[tc.id] = { type: 'navigate', to: PAGE_ROUTE[page] };
      } else if (name === 'link_telegram') {
        if (signedIn) {
          result = { ok: true };
          actionMap[tc.id] = { type: 'link_telegram' };
        } else {
          // Signed out — send them to signup instead of Settings (which would
          // just bounce to the login page).
          result = { ok: false, reason: 'not_signed_in', action: 'signup' };
          actionMap[tc.id] = { type: 'navigate', to: '/auth?mode=signup' };
        }
      } else if (name === 'start_checkout') {
        if (signedIn) {
          result = { ok: true };
          actionMap[tc.id] = { type: 'start_checkout' };
        } else {
          result = { ok: false, reason: 'not_signed_in', action: 'login' };
          actionMap[tc.id] = { type: 'navigate', to: '/auth?mode=login' };
        }
      } else {
        result = { ok: false, reason: 'unknown_tool' };
      }
      toolMessages.push({
        role: 'assistant',
        content: '',
        tool_calls: toolCalls,
      });
      toolMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }

    let second = await groqCompletion([...messages, ...toolMessages], 'none');
    if (!second.ok) {
      console.error('assistant summary round failed:', second.reason);
      second = await groqCompletion(messages, undefined, false);
    }
    const reply = cleanReply(
      second.ok ? (second.choice?.message.content ?? '…') : (first.choice?.message.content ?? '…'),
    );
    const action =
      toolCalls.map((tc) => actionMap[tc.id]).find(Boolean) ??
      (intent ? extractProseAction(reply, signedIn) : null);
    res.status(200).json({ reply, action: action ?? null });
  } catch {
    res.status(500).json({ error: 'internal_error' });
  }
}
