/**
 * Dev-only fixture page for TM-48 evaluator robustness E2E checks.
 *
 * Visible only when NODE_ENV !== 'production'. The page accepts a `jsCode`
 * query parameter (URL-encoded), runs it through the same
 * validate → sanitize → evaluate pipeline as the studio, and renders the
 * friendly fallback UI (or the component) so Playwright can assert that no
 * raw stack traces leak into the DOM or the console.
 *
 * Not linked from anywhere — Playwright navigates here directly.
 */
import { notFound } from 'next/navigation';
import { EvalFixtureClient } from './client';

export const dynamic = 'force-dynamic';

export default async function DevEvalFixturePage(
  props: { searchParams: Promise<{ jsCode?: string; sandboxError?: string }> },
) {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }
  const sp = await props.searchParams;
  const jsCode = sp.jsCode ?? '';
  return <EvalFixtureClient initialCode={jsCode} />;
}
