/**
 * ChatWidget.tsx — floating agentic support assistant.
 *
 * Talks to /api/chat (Groq + tools). When the assistant returns an action,
 * the widget performs it: navigate, jump to Telegram linking, or start the
 * Paystack checkout.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SITE_URL } from '../lib/site';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}
interface ChatAction {
  type: 'navigate' | 'link_telegram' | 'start_checkout';
  to?: string;
}
interface ChatResponse {
  reply?: string;
  action?: ChatAction | null;
  error?: string;
}

const QUICK_PROMPTS = [
  'How do I upgrade?',
  'How do I link Telegram?',
  'When are signals generated?',
  'What is the free trial?',
];

export default function ChatWidget() {
  const { session, profile, access } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [unread, setUnread] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [history, busy, open]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput('');
    setBusy(true);
    setHistory((h) => [...h, { role: 'user', content: msg }]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          history,
          user: {
            signedIn: Boolean(session),
            plan: profile?.role,
            email: profile?.email,
          },
        }),
      });
      const data = (await res.json()) as ChatResponse;
      if (!res.ok || data.error) {
        setHistory((h) => [
          ...h,
          { role: 'assistant', content: 'Sorry — I could not reach the assistant. Please try again in a moment.' },
        ]);
      } else {
        setHistory((h) => [...h, { role: 'assistant', content: data.reply ?? '…' }]);
        if (data.action) {
          runAction(data.action);
        }
        if (!open) setUnread((n) => n + 1);
      }
    } catch {
      setHistory((h) => [
        ...h,
        { role: 'assistant', content: 'Network error — please try again.' },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const runAction = (action: ChatAction) => {
    if (action.type === 'navigate' && action.to) {
      navigate(action.to);
    } else if (action.type === 'link_telegram') {
      navigate('/settings', { state: { connectTelegram: true } });
    } else if (action.type === 'start_checkout') {
      navigate('/dashboard?upgrade=1');
    }
  };

  return (
    <>
      <button
        className="chat-fab"
        aria-label="Open support chat"
        onClick={() => {
          setOpen((v) => !v);
          setUnread(0);
        }}
      >
        {open ? '✕' : '💬'}
        {!open && unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              background: 'var(--blue)',
              color: '#fff',
              fontSize: 11,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              display: 'grid',
              placeItems: 'center',
              paddingInline: 4,
            }}
          >
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="glass chat-window" role="dialog" aria-label="AtlasSignals support chat">
          <div className="chat-head">
            <div className="avatar">⚡</div>
            <div>
              <h3>Atlas assistant</h3>
              <p>
                {access.ok ? `Signed in · ${profile?.role.replace('_', ' ')}` : 'Answers + actions · 24/7'}
              </p>
            </div>
            <a
              href={`${SITE_URL}/#faq`}
              style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-dim)' }}
            >
              FAQ ↗
            </a>
          </div>

          <div className="chat-body" ref={bodyRef}>
            {history.length === 0 && !busy && (
              <div className="msg bot" style={{ color: 'var(--text-muted)' }}>
                Hey 👋 I'm the AtlasSignals assistant. Ask me about pricing, the free trial,
                linking Telegram, market hours — or tell me to open a page for you.
              </div>
            )}
            {history.map((m, i) => (
              <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'bot'}`}>
                {m.content}
              </div>
            ))}
            {busy && (
              <div className="msg bot typing" aria-label="Assistant is typing">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          <div className="chat-quick">
            {QUICK_PROMPTS.map((q) => (
              <button key={q} onClick={() => void send(q)}>
                {q}
              </button>
            ))}
          </div>

          <form
            className="chat-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              className="input"
              placeholder="Ask anything…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Chat message"
            />
            <button className="chat-send" type="submit" disabled={busy || !input.trim()} aria-label="Send">
              ➤
            </button>
          </form>
        </div>
      )}
    </>
  );
}
