/**
 * Footer.tsx — brand, quick links, legal + disclaimer.
 */
import { Link } from 'react-router-dom';
import { APP_NAME, COMPANY_NAME, COMPANY_URL, CONTACT_EMAIL, NAV_LINKS, TELEGRAM_BOT_USERNAME } from '../lib/site';
import Logo from './Logo';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <Logo />
            <p className="muted" style={{ marginTop: 14, maxWidth: 320, fontSize: 14 }}>
              {APP_NAME} — low-latency XAU/USD trading signals from a multi-timeframe
              opportunity-scoring engine. Delivered to your dashboard and Telegram the
              moment they are approved.
            </p>
          </div>
          <div>
            <h4>Product</h4>
            {NAV_LINKS.map((l) => (
              <a key={l.label} href={l.href}>
                {l.label}
              </a>
            ))}
            <Link to="/auth?mode=signup">Start free trial</Link>
          </div>
          <div>
            <h4>Connect</h4>
            <a
              href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Telegram bot
            </a>
            <a href={`mailto:${CONTACT_EMAIL}`}>Support</a>
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/settings">Settings</Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} {APP_NAME} ·{' '}
            <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" style={{ display: 'inline', padding: 0 }}>
              {COMPANY_NAME}
            </a>
          </span>
          <span className="dim">
            Trading involves substantial risk of loss. Signals are informational output, not
            financial advice.
          </span>
        </div>
      </div>
    </footer>
  );
}
