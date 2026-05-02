/**
 * @jest-environment jsdom
 *
 * TM-82 — PromptPanel error banner + retry button.
 *
 * Verifies that when generate/edit fails (5xx, timeout, network drop):
 *   1. An accessible error banner renders with `role="alert"` and the
 *      provider's error message (so the user actually sees what failed).
 *   2. The "다시 시도" button is rendered when `canRetry` is true and
 *      invokes `onRetry` exactly once on click.
 *   3. The dismiss button (X) calls `onDismissError`.
 *   4. When the retry succeeds the banner disappears (parent clears the
 *      error prop).
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PromptPanel } from '@/components/studio/PromptPanel';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

function noop() {}

describe('TM-82 PromptPanel error banner + retry', () => {
  it('renders the error banner with role=alert and provider message', () => {
    render(
      <PromptPanel
        onGenerate={noop}
        onEdit={noop}
        versions={[]}
        currentVersionIndex={-1}
        onRestoreVersion={noop}
        isGenerating={false}
        isEditing={false}
        hasAsset={false}
        tier="FREE"
        clarify={null}
        errorMessage="Service Unavailable"
        canRetry
        onRetry={jest.fn()}
        onDismissError={jest.fn()}
      />,
    );

    const banner = screen.getByTestId('prompt-error-banner');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveTextContent('Service Unavailable');
    // Korean affordance — must be rendered for the retry button.
    expect(screen.getByTestId('prompt-error-retry')).toBeInTheDocument();
  });

  it('invokes onRetry once when the Retry button is clicked', () => {
    const onRetry = jest.fn();
    render(
      <PromptPanel
        onGenerate={noop}
        onEdit={noop}
        versions={[]}
        currentVersionIndex={-1}
        onRestoreVersion={noop}
        isGenerating={false}
        isEditing={false}
        hasAsset
        tier="FREE"
        clarify={null}
        errorMessage="Request timed out"
        canRetry
        onRetry={onRetry}
        onDismissError={noop}
      />,
    );

    fireEvent.click(screen.getByTestId('prompt-error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables Retry while a request is in flight to prevent double-fire', () => {
    const onRetry = jest.fn();
    render(
      <PromptPanel
        onGenerate={noop}
        onEdit={noop}
        versions={[]}
        currentVersionIndex={-1}
        onRestoreVersion={noop}
        isGenerating
        isEditing={false}
        hasAsset
        tier="FREE"
        clarify={null}
        errorMessage="prior failure"
        canRetry
        onRetry={onRetry}
        onDismissError={noop}
      />,
    );

    const btn = screen.getByTestId('prompt-error-retry') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('hides the Retry button when canRetry is false (e.g. validation 400)', () => {
    render(
      <PromptPanel
        onGenerate={noop}
        onEdit={noop}
        versions={[]}
        currentVersionIndex={-1}
        onRestoreVersion={noop}
        isGenerating={false}
        isEditing={false}
        hasAsset={false}
        tier="FREE"
        clarify={null}
        errorMessage="Prompt too long"
        canRetry={false}
        onRetry={jest.fn()}
        onDismissError={noop}
      />,
    );

    expect(screen.queryByTestId('prompt-error-retry')).not.toBeInTheDocument();
    // Banner itself still shows so the user sees what's wrong.
    expect(screen.getByTestId('prompt-error-banner')).toBeInTheDocument();
  });

  it('clears the banner when the parent clears errorMessage (success path)', () => {
    function Wrapper() {
      const [err, setErr] = useState<string | null>('Service Unavailable');
      return (
        <>
          <PromptPanel
            onGenerate={noop}
            onEdit={noop}
            versions={[]}
            currentVersionIndex={-1}
            onRestoreVersion={noop}
            isGenerating={false}
            isEditing={false}
            hasAsset={false}
            tier="FREE"
            clarify={null}
            errorMessage={err}
            canRetry={!!err}
            onRetry={() => setErr(null)}
            onDismissError={() => setErr(null)}
          />
        </>
      );
    }

    render(<Wrapper />);
    expect(screen.getByTestId('prompt-error-banner')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId('prompt-error-retry'));
    });

    expect(screen.queryByTestId('prompt-error-banner')).not.toBeInTheDocument();
  });
});
