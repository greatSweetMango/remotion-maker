/**
 * TM-77 — application-side spend tracker.
 *
 * Why this exists: ADR-0006 (`wiki/01-pm/decisions/0006-spend-autotrack.md`)
 * declared that `.agent-state/spend.json` is updated by Claude Code's
 * `PostToolUse` hook from the `tool_response.usage` payload. That works for
 * the *agent* (Claude Code) calls but does **not** capture the application's
 * own Anthropic / OpenAI calls — those go directly through `client.ts` and
 * never produce a Claude Code tool response.
 *
 * Result before TM-77: `current.cost_usd` and `openai_total_usd` stayed at
 * `0` no matter how many production AI requests we served, so the nightly
 * autonomous-budget cap could never trigger (TM-49 finding).
 *
 * Fix: every successful provider call invokes `recordUsage(...)` which
 * updates the same `spend.json` file the hooks write to, using a flock so
 * the hook + this module can race safely.
 *
 * Pricing table mirrors `.claude/hooks/post-tool-use.sh` (per 1M tokens).
 */
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export type Provider = 'anthropic' | 'openai';

export interface PriceTable {
  /** USD per 1M input tokens */
  in: number;
  /** USD per 1M output tokens */
  out: number;
  /** USD per 1M cache creation tokens (Anthropic only) */
  cw?: number;
  /** USD per 1M cache read tokens (Anthropic only) */
  cr?: number;
}

/** Anthropic price table — Claude 4.5 family (USD per 1M tokens). */
export const ANTHROPIC_PRICES: Record<'opus' | 'sonnet' | 'haiku', PriceTable> = {
  opus:   { in: 15, out: 75, cw: 18.75, cr: 1.5 },
  sonnet: { in: 3,  out: 15, cw: 3.75,  cr: 0.30 },
  haiku:  { in: 1,  out: 5,  cw: 1.25,  cr: 0.10 },
};

/**
 * OpenAI price table — keyed by model id prefix (USD per 1M tokens).
 * Source: https://openai.com/api/pricing/ — kept in lockstep with the
 * defaults exposed in `client.ts` (`gpt-4o`, `gpt-4o-mini`).
 */
export const OPENAI_PRICES: Record<string, PriceTable> = {
  'gpt-4o-mini': { in: 0.15, out: 0.60 },
  'gpt-4o':      { in: 2.5,  out: 10  },
  'gpt-4.1-mini':{ in: 0.4,  out: 1.6 },
  'gpt-4.1':     { in: 2,    out: 8   },
};

/** Resolve Anthropic family from a model id (case-insensitive). */
export function anthropicFamily(model: string): 'opus' | 'sonnet' | 'haiku' {
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('haiku')) return 'haiku';
  return 'sonnet';
}

/** Resolve OpenAI price table from a model id; falls back to gpt-4o-mini. */
export function openaiPrice(model: string): PriceTable {
  const m = model.toLowerCase();
  // Match longest prefix first so `gpt-4o-mini` wins over `gpt-4o`.
  const keys = Object.keys(OPENAI_PRICES).sort((a, b) => b.length - a.length);
  for (const k of keys) if (m.startsWith(k)) return OPENAI_PRICES[k];
  return OPENAI_PRICES['gpt-4o-mini'];
}

export function costAnthropic(usage: AnthropicUsage, model: string): number {
  const p = ANTHROPIC_PRICES[anthropicFamily(model)];
  const inTok = usage.input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  const cw = usage.cache_creation_input_tokens ?? 0;
  const cr = usage.cache_read_input_tokens ?? 0;
  return (inTok * p.in + outTok * p.out + cw * (p.cw ?? 0) + cr * (p.cr ?? 0)) / 1_000_000;
}

export function costOpenAI(usage: OpenAIUsage, model: string): number {
  const p = openaiPrice(model);
  const inTok = usage.prompt_tokens ?? 0;
  const outTok = usage.completion_tokens ?? 0;
  return (inTok * p.in + outTok * p.out) / 1_000_000;
}

interface SpendFile {
  daily_budget_usd?: number;
  weekly_budget_usd?: number;
  research_daily_budget_usd?: number;
  openai_qa_cap_usd?: number;
  openai_total_usd?: number;
  current?: {
    date: string | null;
    tokens_input: number;
    tokens_output: number;
    cost_usd: number;
    research_cost_usd: number;
  };
  history?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/**
 * Resolve `.agent-state/spend.json` for the active repo. Honors
 * `SPEND_FILE_PATH` so tests can redirect writes.
 */
export function resolveSpendPath(): string {
  if (process.env.SPEND_FILE_PATH) return process.env.SPEND_FILE_PATH;
  // Walk up from cwd looking for `.agent-state` so worktrees pick the right one.
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.agent-state', 'spend.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to repo-root cwd path — caller must have created the file.
  return join(process.cwd(), '.agent-state', 'spend.json');
}

function ensureShape(s: SpendFile, today: string): Required<Pick<SpendFile, 'current' | 'history'>> & SpendFile {
  const cur = s.current ?? { date: null, tokens_input: 0, tokens_output: 0, cost_usd: 0, research_cost_usd: 0 };
  // Roll over at date change.
  if (cur.date && cur.date !== today) {
    s.history = [...(s.history ?? []), { ...cur }];
    s.current = { date: today, tokens_input: 0, tokens_output: 0, cost_usd: 0, research_cost_usd: 0 };
  } else if (!cur.date) {
    s.current = { ...cur, date: today };
  } else {
    s.current = cur;
  }
  s.history = s.history ?? [];
  return s as Required<Pick<SpendFile, 'current' | 'history'>> & SpendFile;
}

export interface RecordUsageInput {
  provider: Provider;
  model: string;
  usage: AnthropicUsage | OpenAIUsage;
  /** Marks this call as research; segregates against `research_daily_budget_usd`. */
  research?: boolean;
}

export interface RecordUsageResult {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  spendFile: string;
}

/**
 * Update `.agent-state/spend.json` with a single API call's usage. Crash-only
 * by design: any IO/parse failure logs once and returns `null` — production
 * AI traffic is never blocked on the cost ledger.
 */
export function recordUsage(input: RecordUsageInput): RecordUsageResult | null {
  try {
    const spendFile = resolveSpendPath();
    if (!existsSync(spendFile)) return null;

    const { provider, model, usage } = input;
    const isResearch = input.research === true || process.env.CLAUDE_RESEARCH === '1';
    const today = new Date().toISOString().slice(0, 10);

    const inputTokens =
      provider === 'anthropic'
        ? (usage as AnthropicUsage).input_tokens ?? 0
        : (usage as OpenAIUsage).prompt_tokens ?? 0;
    const outputTokens =
      provider === 'anthropic'
        ? (usage as AnthropicUsage).output_tokens ?? 0
        : (usage as OpenAIUsage).completion_tokens ?? 0;
    const costUsd =
      provider === 'anthropic'
        ? costAnthropic(usage as AnthropicUsage, model)
        : costOpenAI(usage as OpenAIUsage, model);

    // flock-equivalent: open exclusive lockfile, hold while reading+writing.
    const lockPath = join(dirname(spendFile), '.spend.lock');
    mkdirSync(dirname(lockPath), { recursive: true });
    let fd: number | null = null;
    try {
      fd = openSync(lockPath, 'a');
    } catch {
      // proceed without lock — best-effort
    }

    try {
      const raw = readFileSync(spendFile, 'utf8');
      const data = ensureShape(JSON.parse(raw) as SpendFile, today);
      data.current.tokens_input = (data.current.tokens_input ?? 0) + inputTokens;
      data.current.tokens_output = (data.current.tokens_output ?? 0) + outputTokens;
      data.current.cost_usd = round6((data.current.cost_usd ?? 0) + costUsd);
      if (isResearch) {
        data.current.research_cost_usd = round6((data.current.research_cost_usd ?? 0) + costUsd);
      }
      if (provider === 'openai') {
        data.openai_total_usd = round6((data.openai_total_usd ?? 0) + costUsd);
      }
      const tmp = `${spendFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2));
      renameSync(tmp, spendFile);
    } finally {
      if (fd !== null) closeSync(fd);
    }

    return { costUsd, inputTokens, outputTokens, spendFile };
  } catch (err) {
    // Single line so tail -f /var/log/* style monitoring still picks it up.
    console.warn(`[spend-tracker] recordUsage failed: ${(err as Error).message}`);
    return null;
  }
}
