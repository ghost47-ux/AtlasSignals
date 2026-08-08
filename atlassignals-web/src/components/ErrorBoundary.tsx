/**
 * ErrorBoundary.tsx — last-resort UI when a page crashes, so the app never
 * degrades to a blank screen (footer-only) after a client-side navigation.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Page crashed:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="center-loading">
          <div className="glass panel lock-screen" style={{ maxWidth: 460, margin: 24 }}>
            <div className="icon">⚠️</div>
            <h2 style={{ marginBottom: 10 }}>Something went wrong</h2>
            <p className="muted" style={{ marginBottom: 20, fontSize: 14 }}>
              The page hit an unexpected error. A quick reload usually fixes it.
            </p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
