/**
 * Pricing.tsx — trial vs Pro pricing section.
 */
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PLAN_LABEL } from '../lib/site';
import Reveal from './Reveal';

export default function Pricing() {
  const { session } = useAuth();
  const navigate = useNavigate();

  const cta = (path: string) => () => navigate(session ? '/dashboard' : path);

  return (
    <div className="pricing-grid">
      <Reveal>
        <div className="glass price-card">
          <div className="plan">Free trial</div>
          <div className="amount">₦0</div>
          <div className="period">24 hours · full access</div>
          <ul className="price-list">
            <li>Every approved XAU/USD signal</li>
            <li>Entry, stop loss &amp; take profit levels</li>
            <li>Confidence score + setup breakdown</li>
            <li>Real-time dashboard + Telegram</li>
            <li>
              Signs up over the weekend? Your trial starts Monday, when the
              market opens.
            </li>
          </ul>
          <button className="btn btn-ghost btn-block" onClick={cta('/auth?mode=signup')}>
            Start free trial
          </button>
        </div>
      </Reveal>

      <Reveal delay={90}>
        <div className="glass price-card featured">
          <div className="plan">Pro</div>
          <div className="amount">{PLAN_LABEL.split('/')[0]}</div>
          <div className="period">per month · cancel anytime</div>
          <ul className="price-list">
            <li>Everything in the free trial, forever</li>
            <li>Automatic monthly renewal via Paystack</li>
            <li>Priority delivery to your Telegram</li>
            <li>Full signal history in the dashboard</li>
            <li>Multi-timeframe engine access (15M)</li>
          </ul>
          <button className="btn btn-primary btn-block" onClick={cta('/auth?mode=signup')}>
            Upgrade — {PLAN_LABEL}
          </button>
        </div>
      </Reveal>
    </div>
  );
}
