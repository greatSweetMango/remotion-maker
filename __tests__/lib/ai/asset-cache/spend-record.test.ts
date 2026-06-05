/**
 * TM-89 — recordAssetGenSpend writes exactly the flat gpt-image-1 price into
 * the spend ledger on a MISS, and nothing on a HIT (cost 0).
 *
 * Redirects the ledger via SPEND_FILE_PATH (TM-77 test seam).
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordAssetGenSpend } from '@/lib/ai/asset-gen-stage';
import { costOpenAI, openaiPrice } from '@/lib/ai/spend';

function setupSpendFile() {
  const dir = mkdtempSync(join(tmpdir(), 'tm89-spend-'));
  mkdirSync(join(dir, '.agent-state'), { recursive: true });
  const file = join(dir, '.agent-state', 'spend.json');
  writeFileSync(file, JSON.stringify({
    openai_total_usd: 0,
    current: { date: null, tokens_input: 0, tokens_output: 0, cost_usd: 0, research_cost_usd: 0 },
    history: [],
  }, null, 2));
  process.env.SPEND_FILE_PATH = file;
  return { dir, file };
}

describe('TM-89 recordAssetGenSpend', () => {
  let dir: string;
  let file: string;
  beforeEach(() => { ({ dir, file } = setupSpendFile()); });
  afterEach(() => { delete process.env.SPEND_FILE_PATH; rmSync(dir, { recursive: true, force: true }); });

  it('gpt-image-1 priced as a $1/1M unit scalar (token-encoding is exact)', () => {
    // 0.04 * 1e6 tokens @ $1/1M = $0.04 — exactly the flat per-image price.
    expect(openaiPrice('gpt-image-1').in).toBe(1);
    expect(costOpenAI({ prompt_tokens: 0.04 * 1_000_000, completion_tokens: 0 }, 'gpt-image-1')).toBeCloseTo(0.04, 6);
  });

  it('MISS: records the flat image cost into current.cost_usd + openai_total_usd', () => {
    recordAssetGenSpend(0.04);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    expect(data.current.cost_usd).toBeCloseTo(0.04, 6);
    expect(data.openai_total_usd).toBeCloseTo(0.04, 6);
  });

  it('HIT: cost 0 records nothing (ledger untouched)', () => {
    recordAssetGenSpend(0);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    expect(data.current.cost_usd).toBe(0);
    expect(data.openai_total_usd).toBe(0);
  });
});
