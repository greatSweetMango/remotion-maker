/**
 * TM-45 fuzz runner.
 *
 * Usage:
 *   npx tsx scripts/fuzz/run.ts
 *
 * Requires:
 *   - dev server running on PORT (default 3045)
 *   - DEV_AUTO_LOGIN=true (so /api/dev/auto-login works)
 *   - OPENAI_API_KEY in env (loaded by Next from .env.local)
 *
 * Strategy:
 *   1. Hit /api/dev/auto-login to obtain authjs.session-token cookie.
 *   2. POST each case to /api/generate with that cookie.
 *   3. Record HTTP status, JSON shape, error msg, latency.
 *   4. For 2xx generate responses, run the returned `jsCode` through the
 *      sandbox validator/evaluator locally to confirm no XSS/injection escape.
 *   5. Write JSON results + markdown summary.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CASES, type FuzzCase } from './cases';
import { validateCode } from '../../src/lib/remotion/sandbox';

const PORT = process.env.PORT ?? '3045';
const BASE = `http://localhost:${PORT}`;
const OUT_DIR = resolve(__dirname, '../../.agent-state/fuzz-results');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

interface Result {
  id: string;
  category: string;
  prompt_excerpt: string;
  prompt_length: number;
  status: number;
  ok: boolean;
  body: unknown;
  error_msg?: string;
  latency_ms: number;
  expectation: FuzzCase['expect'];
  verdict: 'PASS' | 'FAIL' | 'WARN';
  verdict_reason: string;
  sandbox_recheck?: { ran: boolean; valid: boolean; errors: string[] };
}

async function getAuthCookie(): Promise<string> {
  const res = await fetch(`${BASE}/api/dev/auto-login?callbackUrl=/studio`, {
    redirect: 'manual',
  });
  // signIn() issues Set-Cookie headers and a 30x redirect.
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (!setCookies.length) {
    // Some node versions: fall back to raw header
    const raw = res.headers.get('set-cookie');
    if (!raw) throw new Error(`No Set-Cookie from auto-login (status ${res.status})`);
    return raw.split(/,(?=\s*[\w%-]+=)/).map(c => c.split(';')[0].trim()).join('; ');
  }
  return setCookies.map(c => c.split(';')[0].trim()).join('; ');
}

function classify(c: FuzzCase, status: number, body: unknown, errorMsg: string | undefined, sandboxOk: boolean | null): { verdict: Result['verdict']; reason: string } {
  const e = c.expect;

  // Universal rule: status must NOT be a server crash signal we can't decode.
  // Anything outside [200, 599] = FAIL.
  if (status === 0) return { verdict: 'FAIL', reason: 'connection error / no response' };

  switch (e.kind) {
    case 'http_4xx':
      if (status >= 400 && status < 500) return { verdict: 'PASS', reason: `4xx as expected (${e.reason})` };
      if (status >= 500) return { verdict: 'WARN', reason: `expected 4xx, got 5xx — graceful but loose validation` };
      return { verdict: 'FAIL', reason: `expected 4xx, got ${status}` };
    case 'http_2xx_clarify':
      if (status === 200 && (body as any)?.type === 'clarify') return { verdict: 'PASS', reason: 'clarify' };
      return { verdict: 'FAIL', reason: `expected 200 clarify, got ${status}` };
    case 'http_2xx_generate_safe':
      if (status >= 400) return { verdict: 'PASS', reason: `rejected upstream (${status}: ${errorMsg})` };
      if (status === 200 && (body as any)?.type === 'generate') {
        if (sandboxOk === false) return { verdict: 'PASS', reason: 'generate returned but sandbox would re-reject' };
        if (sandboxOk === true) {
          // Verify mustNotContain patterns absent
          const code = (body as any)?.asset?.code ?? '';
          const violations = (e.mustNotContain ?? []).filter(p => code.includes(p));
          if (violations.length) return { verdict: 'FAIL', reason: `XSS/injection leaked: ${violations.join(', ')}` };
          return { verdict: 'PASS', reason: 'generated safely (no forbidden patterns in code)' };
        }
      }
      if (status === 200 && (body as any)?.type === 'clarify') return { verdict: 'PASS', reason: 'clarify (asked instead of running injection)' };
      return { verdict: 'WARN', reason: `unexpected shape: ${status} ${JSON.stringify(body)?.slice(0, 100)}` };
    case 'http_5xx_graceful':
      if (status >= 500 && typeof errorMsg === 'string' && errorMsg.length > 0) return { verdict: 'PASS', reason: `graceful 5xx with msg: ${errorMsg}` };
      if (status === 200) return { verdict: 'WARN', reason: 'LLM ignored adversarial instruction (returned valid output)' };
      if (status >= 400 && status < 500) return { verdict: 'PASS', reason: `4xx (${errorMsg ?? ''})` };
      return { verdict: 'FAIL', reason: `expected graceful 5xx, got ${status}` };
    case 'either_2xx_or_4xx_no_crash':
      if (status >= 200 && status < 600) return { verdict: 'PASS', reason: `no crash (${status})` };
      return { verdict: 'FAIL', reason: `unexpected: ${status}` };
  }
}

async function run() {
  console.log(`[TM-45] Authenticating against ${BASE}...`);
  const cookie = await getAuthCookie();
  console.log(`[TM-45] Got auth cookies (${cookie.split(';').length} items)`);

  const results: Result[] = [];
  for (const c of CASES) {
    const start = Date.now();
    let status = 0;
    let body: unknown = null;
    let errorMsg: string | undefined;
    let sandboxOk: boolean | null = null;
    let sandboxRecheck: Result['sandbox_recheck'];

    try {
      const res = await fetch(`${BASE}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ prompt: c.prompt }),
      });
      status = res.status;
      const text = await res.text();
      try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 500) }; }
      if (typeof body === 'object' && body && 'error' in body) {
        errorMsg = String((body as any).error);
      }
      // If injection case + got generate, re-run sandbox locally on returned code.
      if (status === 200 && (body as any)?.type === 'generate') {
        const code = String((body as any)?.asset?.code ?? '');
        const v = validateCode(code);
        sandboxOk = v.valid;
        sandboxRecheck = { ran: true, valid: v.valid, errors: v.errors };
      }
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
      status = 0;
    }
    const latency = Date.now() - start;

    const cls = classify(c, status, body, errorMsg, sandboxOk);

    const r: Result = {
      id: c.id,
      category: c.category,
      prompt_excerpt: c.prompt.length > 100 ? c.prompt.slice(0, 100) + `…(+${c.prompt.length - 100} chars)` : c.prompt,
      prompt_length: c.prompt.length,
      status,
      ok: cls.verdict === 'PASS',
      body,
      error_msg: errorMsg,
      latency_ms: latency,
      expectation: c.expect,
      verdict: cls.verdict,
      verdict_reason: cls.reason,
      sandbox_recheck: sandboxRecheck,
    };
    results.push(r);
    const tag = r.verdict === 'PASS' ? 'PASS' : r.verdict === 'WARN' ? 'WARN' : 'FAIL';
    console.log(`[${tag}] ${c.id} (${c.category}) status=${status} ${latency}ms — ${cls.reason}`);
  }

  writeFileSync(resolve(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));

  const pass = results.filter(r => r.verdict === 'PASS').length;
  const warn = results.filter(r => r.verdict === 'WARN').length;
  const fail = results.filter(r => r.verdict === 'FAIL').length;
  console.log(`\n[TM-45] PASS=${pass} WARN=${warn} FAIL=${fail} / ${results.length}`);

  // Markdown summary
  const md = renderMarkdown(results, { pass, warn, fail });
  writeFileSync(resolve(OUT_DIR, 'summary.md'), md);
  console.log(`[TM-45] Wrote ${OUT_DIR}/results.json + summary.md`);

  if (fail > 0) process.exit(2);
}

function renderMarkdown(rs: Result[], totals: { pass: number; warn: number; fail: number }) {
  const lines = [
    `# TM-45 Edge Fuzzing — raw results`,
    ``,
    `Date: ${new Date().toISOString()}`,
    `Endpoint: \`POST /api/generate\` @ ${BASE}`,
    `Cases: ${rs.length}  PASS=${totals.pass}  WARN=${totals.warn}  FAIL=${totals.fail}`,
    ``,
    `| ID | Cat | Status | Verdict | Latency | Reason |`,
    `|---|---|---|---|---|---|`,
  ];
  for (const r of rs) {
    lines.push(`| ${r.id} | ${r.category} | ${r.status} | ${r.verdict} | ${r.latency_ms}ms | ${r.verdict_reason.replace(/\|/g, '\\|')} |`);
  }
  lines.push('', '## Per-case details', '');
  for (const r of rs) {
    lines.push(`### ${r.id} (${r.category}) — ${r.verdict}`);
    lines.push(`- prompt (${r.prompt_length} chars): \`${r.prompt_excerpt.replace(/`/g, '\\`')}\``);
    lines.push(`- HTTP: ${r.status}${r.error_msg ? ` — ${r.error_msg}` : ''}`);
    lines.push(`- expectation: ${r.expectation.kind}`);
    lines.push(`- verdict: **${r.verdict}** — ${r.verdict_reason}`);
    if (r.sandbox_recheck) {
      lines.push(`- sandbox re-check: valid=${r.sandbox_recheck.valid}${r.sandbox_recheck.errors.length ? ' errors=' + r.sandbox_recheck.errors.join(',') : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

run().catch(e => { console.error(e); process.exit(1); });
