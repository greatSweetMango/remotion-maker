/**
 * TM-77 — exec the actual `.claude/hooks/post-tool-use.sh` against synthetic
 * payloads to prove the OpenAI branch updates `openai_total_usd` and the
 * Anthropic branch updates Claude pricing without crossfeeding.
 *
 * Skipped when `jq` is missing — the hook is documented as a soft-degrade
 * (just like in production).
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function hasJq(): boolean {
  try {
    execSync('command -v jq', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HOOK_SRC = resolve(__dirname, '../../.claude/hooks/post-tool-use.sh');

function setupSandbox(): { dir: string; spendFile: string; hookPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tm77-hook-'));
  // Hook resolves SPEND_FILE relative to its own location: ../../.agent-state/spend.json
  // → so we plant the hook at <dir>/.claude/hooks/post-tool-use.sh.
  const hooksDir = join(dir, '.claude', 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, 'post-tool-use.sh');
  copyFileSync(HOOK_SRC, hookPath);
  // Preserve exec bit (copyFileSync may drop it on some FS).
  execSync(`chmod +x "${hookPath}"`);

  mkdirSync(join(dir, '.agent-state'), { recursive: true });
  const spendFile = join(dir, '.agent-state', 'spend.json');
  writeFileSync(
    spendFile,
    JSON.stringify({
      daily_budget_usd: 50,
      weekly_budget_usd: 200,
      research_daily_budget_usd: 5,
      openai_qa_cap_usd: 18,
      openai_total_usd: 0,
      current: { date: null, tokens_input: 0, tokens_output: 0, cost_usd: 0, research_cost_usd: 0 },
      history: [],
    }),
  );
  return { dir, spendFile, hookPath };
}

function runHook(hookPath: string, payload: object) {
  execFileSync(hookPath, [], {
    input: JSON.stringify(payload),
    stdio: ['pipe', 'ignore', 'inherit'],
  });
}

const maybe = hasJq() ? describe : describe.skip;

maybe('TM-77 PostToolUse hook (bash)', () => {
  let sandbox: ReturnType<typeof setupSandbox>;

  beforeEach(() => {
    sandbox = setupSandbox();
  });

  afterEach(() => {
    rmSync(sandbox.dir, { recursive: true, force: true });
  });

  test('Anthropic Sonnet usage updates current.cost_usd, leaves openai_total_usd at 0', () => {
    runHook(sandbox.hookPath, {
      tool_response: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 1000, output_tokens: 500 },
      },
    });
    const data = JSON.parse(readFileSync(sandbox.spendFile, 'utf8'));
    expect(data.current.tokens_input).toBe(1000);
    expect(data.current.tokens_output).toBe(500);
    expect(data.current.cost_usd).toBeGreaterThan(0);
    expect(data.openai_total_usd).toBe(0);
  });

  test('OpenAI gpt-4o-mini usage updates openai_total_usd', () => {
    runHook(sandbox.hookPath, {
      tool_response: {
        model: 'gpt-4o-mini',
        usage: { prompt_tokens: 10_000, completion_tokens: 4_000, total_tokens: 14_000 },
      },
    });
    const data = JSON.parse(readFileSync(sandbox.spendFile, 'utf8'));
    expect(data.openai_total_usd).toBeGreaterThan(0);
    expect(data.current.tokens_input).toBe(10_000);
    expect(data.current.tokens_output).toBe(4_000);
  });

  test('payload without usage exits 0 and does not mutate spend file', () => {
    const before = statSync(sandbox.spendFile).mtimeMs;
    runHook(sandbox.hookPath, { tool_response: {} });
    const data = JSON.parse(readFileSync(sandbox.spendFile, 'utf8'));
    expect(data.current.tokens_input).toBe(0);
    expect(data.openai_total_usd).toBe(0);
    // mtime may or may not change (file is not rewritten when usage missing).
    expect(statSync(sandbox.spendFile).mtimeMs).toBeGreaterThanOrEqual(before);
  });
});
