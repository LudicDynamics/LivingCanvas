/**
 * The app root's error boundary (改进产品, lib/analytics.ts): a render error is reported as an `error` event
 * (kind boundary, scrubbed message + top frames) and the player gets one line and a reload button instead of a
 * blank page.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { currentLocale, translate } from '../lib/i18n.js';
import { reportError } from '../lib/analytics.js';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const e = error as { message?: unknown; stack?: unknown } | null;
    reportError({ kind: 'boundary', message: e?.message ?? String(error), stack: typeof e?.stack === 'string' ? e.stack : info.componentStack, route: window.location.pathname });
  }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const t = (k: string) => translate(currentLocale(), k);
    return (
      <div role="alert" className="app-error-boundary" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', gap: 12, padding: 16, textAlign: 'center' }}>
        <div>
          <p>{t('Something went wrong. Reload the page to continue.')}</p>
          <button type="button" onClick={() => window.location.reload()}>{t('Reload')}</button>
        </div>
      </div>
    );
  }
}
