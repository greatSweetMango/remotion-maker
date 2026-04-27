'use client';
import React from 'react';

/**
 * Catches render-phase errors thrown by an evaluated Remotion component.
 *
 * The evaluator (TM-48) classifies *factory-time* failures and returns them
 * as `EvaluationResult.error`. But a successfully-evaluated component may
 * still throw at *render time* — e.g. SSR-only APIs (`getTotalLength()`),
 * unsupported CSS, undefined-during-render references. Without this
 * boundary those errors bubble up and crash the whole studio.
 *
 * Behaviour:
 *   - swallows the error and shows a localized fallback panel
 *   - logs the raw error to the console only in dev
 *   - resets when the `resetKey` prop changes (e.g. when the user picks a
 *     new asset / edits the code) so a fixed asset can render again
 */
interface Props {
  /** Change this when the underlying jsCode changes to reset the boundary. */
  resetKey: string | number | null;
  children: React.ReactNode;
}

interface State {
  errorMessage: string | null;
}

export class EvaluatorErrorBoundary extends React.Component<Props, State> {
  state: State = { errorMessage: null };

  static getDerivedStateFromError(error: unknown): State {
    const msg =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
    return { errorMessage: msg };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      // Dev-only — keeps the error visible during local iteration.
      // In production this is silent: the user sees only the friendly fallback.
      // eslint-disable-next-line no-console
      console.warn('[EvaluatorErrorBoundary] render-phase error:', error, info.componentStack);
    }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.errorMessage !== null) {
      this.setState({ errorMessage: null });
    }
  }

  render() {
    if (this.state.errorMessage !== null) {
      return (
        <div
          data-testid="evaluator-render-error"
          className="flex flex-col items-center gap-3 text-center max-w-sm p-6"
        >
          <div className="w-12 h-12 rounded-full bg-amber-900/30 flex items-center justify-center text-amber-400">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
          </div>
          <p className="text-slate-200 font-medium">미리보기를 그리는 중 오류가 발생했어요</p>
          <p className="text-slate-500 text-xs">
            컴포넌트가 SSR에서 지원되지 않는 API를 사용하거나, 렌더 도중 예외가 발생했을 수 있어요.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
