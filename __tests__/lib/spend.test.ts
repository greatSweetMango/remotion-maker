/**
 * TM-77 — recordUsage() should mutate `.agent-state/spend.json` so that
 * application-side AI calls feed the same nightly budget gate that the
 * Claude Code PostToolUse hook does (ADR-0006).
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  anthropicFamily,
  costAnthropic,
  costOpenAI,
  openaiPrice,
  recordUsage,
} from '@/lib/ai/spend';

function setupSpendFile(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tm77-spend-'));
  mkdirSync(join(dir, '.agent-state'), { recursive: true });
  const file = join(dir, '.agent-state', 'spend.json');
  writeFileSync(
    file,
    JSON.stringify(
      {
        daily_budget_usd: 50,
        weekly_budget_usd: 200,
        research_daily_budget_usd: 5,
        openai_qa_cap_usd: 18,
        openai_total_usd: 0,
        current: {
          date: null,
          tokens_input: 0,
          tokens_output: 0,
          cost_usd: 0,
          research_cost_usd: 0,
        },
        history: [],
      },
      null,
      2,
    ),
  );
  process.env.SPEND_FILE_PATH = file;
  return { dir, file };
}

describe('TM-77 spend tracker', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    ({ dir, file } = setupSpendFile());
  });

  afterEach(() => {
    delete process.env.SPEND_FILE_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  test('anthropicFamily / openaiPrice resolve correctly', () => {
    expect(anthropicFamily('claude-opus-4-7')).toBe('opus');
    expect(anthropicFamily('claude-sonnet-4-6')).toBe('sonnet');
    expect(anthropicFamily('claude-haiku-4-5-20251001')).toBe('haiku');
    // Unknown defaults to sonnet (mid-tier safe choice for cost gating).
    expect(anthropicFamily('claude-mystery-9000')).toBe('sonnet');

    expect(openaiPrice('gpt-4o-mini').in).toBe(0.15);
    expect(openaiPrice('gpt-4o-2024-08-06').in).toBe(2.5);
  });

  test('cost arithmetic — Anthropic + OpenAI', () => {
    // 1M input @ $3 + 1M output @ $15 = $18 for sonnet
    expect(
      costAnthropic({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 'claude-sonnet-4-6'),
    ).toBeCloseTo(18, 6);
    // 1M prompt @ $0.15 + 1M completion @ $0.60 = $0.75 for gpt-4o-mini
    expect(
      costOpenAI({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, 'gpt-4o-mini'),
    ).toBeCloseTo(0.75, 6);
  });

  test('recordUsage accumulates Anthropic cost into current.cost_usd', () => {
    const result = recordUsage({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    expect(result).not.toBeNull();
    expect(result!.costUsd).toBeCloseTo((1000 * 3 + 500 * 15) / 1_000_000, 6);

    const data = JSON.parse(readFileSync(file, 'utf8'));
    expect(data.current.tokens_input).toBe(1000);
    expect(data.current.tokens_output).toBe(500);
    expect(data.current.cost_usd).toBeGreaterThan(0);
    expect(data.current.date).not.toBeNull();
    // Anthropic must NOT touch the OpenAI counter.
    expect(data.openai_total_usd).toBe(0);
  });

  test('recordUsage accumulates OpenAI cost into both current and openai_total_usd', () => {
    recordUsage({
      provider: 'openai',
      model: 'gpt-4o-mini',
      usage: { prompt_tokens: 10_000, completion_tokens: 4_000, total_tokens: 14_000 },
    });
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const expected = (10_000 * 0.15 + 4_000 * 0.60) / 1_000_000;
    expect(data.openai_total_usd).toBeCloseTo(expected, 6);
    expect(data.current.cost_usd).toBeCloseTo(expected, 6);
    expect(data.current.tokens_input).toBe(10_000);
    expect(data.current.tokens_output).toBe(4_000);
  });

  test('recordUsage tags research spend separately when CLAUDE_RESEARCH=1', () => {
    process.env.CLAUDE_RESEARCH = '1';
    try {
      recordUsage({
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        usage: { input_tokens: 1000, output_tokens: 500 },
      });
    } finally {
      delete process.env.CLAUDE_RESEARCH;
    }
    const data = JSON.parse(readFileSync(file, 'utf8'));
    expect(data.current.research_cost_usd).toBeGreaterThan(0);
    expect(data.current.research_cost_usd).toBeCloseTo(data.current.cost_usd, 6);
  });

  test('multiple calls accumulate (no clobber)', () => {
    for (let i = 0; i < 3; i++) {
      recordUsage({
        provider: 'openai',
        model: 'gpt-4o-mini',
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      });
    }
    const data = JSON.parse(readFileSync(file, 'utf8'));
    expect(data.current.tokens_input).toBe(3000);
    expect(data.current.tokens_output).toBe(1500);
    const perCall = (1000 * 0.15 + 500 * 0.60) / 1_000_000;
    expect(data.openai_total_usd).toBeCloseTo(perCall * 3, 6);
  });

  test('missing spend file is a no-op (does not throw)', () => {
    process.env.SPEND_FILE_PATH = join(dir, '.agent-state', 'does-not-exist.json');
    const result = recordUsage({
      provider: 'openai',
      model: 'gpt-4o-mini',
      usage: { prompt_tokens: 100, completion_tokens: 100 },
    });
    expect(result).toBeNull();
  });
});
