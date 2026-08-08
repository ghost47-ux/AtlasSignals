/**
 * NotFound.tsx — 404 with a way back.
 */
import { Link } from 'react-router-dom';
import Background from '../components/Background';

export default function NotFound() {
  return (
    <>
      <Background />
      <div className="not-found">
        <div>
          <div className="code">404</div>
          <h2 style={{ marginBottom: 10 }}>This page is off the chart</h2>
          <p className="muted" style={{ marginBottom: 26 }}>
            The page you are looking for does not exist — or your stop loss hit it.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/" className="btn btn-primary">
              ← Back to home
            </Link>
            <Link to="/dashboard" className="btn btn-ghost">
              Open dashboard
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
