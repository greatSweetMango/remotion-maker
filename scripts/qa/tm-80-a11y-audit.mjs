#!/usr/bin/env node
/**
 * TM-80 — Accessibility Audit (axe-core + Playwright)
 *
 * Targets:
 *   - / (home / marketing landing)
 *   - /login (auth)
 *   - /studio?template=<id> (customize page) — auth-gated; uses /dev-login auto-bypass
 *   - 5 sample templates loaded into /studio
 *
 * Checks:
 *   - axe-core run() per page  → counts violations by impact (critical/serious/moderate/minor)
 *   - keyboard nav probe       → Tab/Shift-Tab walk; record interactive element coverage
 *   - color-contrast           → axe rule "color-contrast" (WCAG AA)
 *
 * Output:
 *   - wiki/05-reports/screenshots/TM-80/results.json   (machine-readable)
 *   - wiki/05-reports/screenshots/TM-80/summary.txt    (human-readable)
 *
 * Env:
 *   BASE_URL (default http://127.0.0.1:3080)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'wiki', '05-reports', 'screenshots', 'TM-80');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3080';
const SAMPLE_TEMPLATES = [
  'counter-animation',
  'bar-chart',
  'gradient-orbs',
  'particle-physics',
  'fluid-blobs',
];

const AXE_SOURCE = fs.readFileSync(
  path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'),
  'utf8'
);

function summarise(violations) {
  const buckets = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const list = [];
  for (const v of violations ?? []) {
    if (v.impact && buckets[v.impact] != null) buckets[v.impact] += v.nodes?.length ?? 1;
    list.push({
      id: v.id,
      impact: v.impact,
      help: v.help,
      helpUrl: v.helpUrl,
      nodeCount: v.nodes?.length ?? 0,
      sampleSelector: v.nodes?.[0]?.target?.[0] ?? null,
      sampleHtml: v.nodes?.[0]?.html?.slice(0, 200) ?? null,
    });
  }
  return { buckets, list };
}

async function auditPage(page, label, url, { needsAuth = false } = {}) {
  console.log(`[tm-80] auditing ${label}: ${url}`);
  if (needsAuth) {
    // Trigger DEV_AUTO_LOGIN; auto-form posts and redirects to callbackUrl
    await page.goto(`${BASE}/dev-login?callbackUrl=${encodeURIComponent(url.replace(BASE, ''))}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    // After auto-login, ensure target is loaded
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    if (!page.url().startsWith(url.split('?')[0])) {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    }
  } else {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  }

  // Inject axe-core into the page
  await page.addScriptTag({ content: AXE_SOURCE });
  // Run axe with WCAG2AA tags
  const axeResult = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return {
      violations: r.violations,
      passes: r.passes.length,
      incomplete: r.incomplete.length,
    };
  });

  // Keyboard navigation probe — count Tab-reachable focusables
  const kbProbe = await page.evaluate(async () => {
    const interactive = Array.from(
      document.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    return {
      interactiveCount: interactive.length,
      withoutVisibleLabel: interactive.filter((el) => {
        const aria = el.getAttribute('aria-label');
        const text = (el.textContent || '').trim();
        const title = el.getAttribute('title');
        return !aria && !text && !title;
      }).length,
    };
  });

  // Tab walk — press Tab N times and record each focused element's outerHTML signature
  const tabSteps = Math.min(kbProbe.interactiveCount + 3, 30);
  const tabbed = [];
  for (let i = 0; i < tabSteps; i++) {
    await page.keyboard.press('Tab');
    const sig = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        label:
          el.getAttribute('aria-label') ||
          (el.textContent || '').trim().slice(0, 40) ||
          el.getAttribute('title') ||
          null,
        focusVisible: getComputedStyle(el).outlineStyle !== 'none',
      };
    });
    if (sig) tabbed.push(sig);
  }

  const summary = summarise(axeResult.violations);
  const colorContrast = (axeResult.violations ?? []).find((v) => v.id === 'color-contrast');

  return {
    label,
    url,
    axe: {
      passes: axeResult.passes,
      incomplete: axeResult.incomplete,
      ...summary,
    },
    keyboard: {
      ...kbProbe,
      tabReached: tabbed.length,
      sample: tabbed.slice(0, 8),
    },
    colorContrast: colorContrast
      ? {
          nodeCount: colorContrast.nodes?.length ?? 0,
          samples: (colorContrast.nodes ?? []).slice(0, 5).map((n) => ({
            target: n.target?.[0],
            failureSummary: n.failureSummary,
          })),
        }
      : null,
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    bypassCSP: true,
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.warn('[browser:err]', m.text().slice(0, 200));
  });

  const reports = [];
  try {
    reports.push(await auditPage(page, 'home', `${BASE}/`));
    reports.push(await auditPage(page, 'login', `${BASE}/login`));
    reports.push(await auditPage(page, 'customize', `${BASE}/studio`, { needsAuth: true }));
    for (const tid of SAMPLE_TEMPLATES) {
      reports.push(
        await auditPage(page, `tpl:${tid}`, `${BASE}/studio?template=${tid}`, { needsAuth: true })
      );
    }
  } finally {
    await browser.close();
  }

  // Aggregate
  const total = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const r of reports) {
    for (const k of Object.keys(total)) total[k] += r.axe.buckets[k] ?? 0;
  }

  const out = {
    base: BASE,
    runAt: new Date().toISOString(),
    totals: total,
    pages: reports,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(out, null, 2));

  // Summary text
  const lines = [];
  lines.push(`TM-80 a11y audit @ ${out.runAt}`);
  lines.push(`base: ${BASE}`);
  lines.push('');
  lines.push(`TOTAL — critical:${total.critical} serious:${total.serious} moderate:${total.moderate} minor:${total.minor}`);
  lines.push('');
  for (const r of reports) {
    const b = r.axe.buckets;
    lines.push(`# ${r.label}  (${r.url})`);
    lines.push(
      `  axe: c:${b.critical} s:${b.serious} m:${b.moderate} mi:${b.minor}  passes:${r.axe.passes}  incomplete:${r.axe.incomplete}`
    );
    lines.push(
      `  kbd: interactive=${r.keyboard.interactiveCount}  reached=${r.keyboard.tabReached}  unlabeled=${r.keyboard.withoutVisibleLabel}`
    );
    if (r.colorContrast) lines.push(`  contrast violations: ${r.colorContrast.nodeCount}`);
    for (const v of r.axe.list.slice(0, 6)) {
      lines.push(`    - [${v.impact}] ${v.id} (${v.nodeCount}): ${v.help}`);
      if (v.sampleSelector) lines.push(`        sel: ${v.sampleSelector}`);
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(OUT_DIR, 'summary.txt'), lines.join('\n'));

  console.log(lines.join('\n'));
  console.log(`\n[tm-80] wrote ${path.relative(ROOT, OUT_DIR)}/{results.json,summary.txt}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
