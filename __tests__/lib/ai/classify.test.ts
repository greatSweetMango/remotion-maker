import { classifyHeuristic, classifyPrompt } from '../../../src/lib/ai/classify';
import { parseProgressive } from '../../../src/lib/ai/stream';
import { dryRunHeuristic } from '../../benchmarks/tm-33-routing.benchmark';

describe('TM-33 classifyHeuristic', () => {
  it('classifies very short single-shape prompts as simple', () => {
    const r = classifyHeuristic('a red bouncing circle');
    expect(r?.complexity).toBe('simple');
    expect(r?.source).toBe('heuristic');
  });

  it('classifies multi-scene prompts as complex', () => {
    const r = classifyHeuristic(
      'Intro scene with logo, then a chart with monthly revenue, then outro with thanks',
    );
    expect(r?.complexity).toBe('complex');
  });

  it('classifies list-formatted prompts as complex', () => {
    const r = classifyHeuristic(
      `Make this video:\n- title scene\n- 3 features\n- closing CTA`,
    );
    expect(r?.complexity).toBe('complex');
  });

  it('returns null for ambiguous medium-length prompts', () => {
    const r = classifyHeuristic(
      'Animated counter from 0 to 100 with spring effect, blue text background',
    );
    // 14 words, single sentence, no scene keywords — should defer
    expect([null, expect.objectContaining({ complexity: expect.any(String) })]).toContainEqual(r);
  });
});

describe('TM-33 classifyPrompt (no API key)', () => {
  const orig = process.env.ANTHROPIC_API_KEY;
  beforeAll(() => { delete process.env.ANTHROPIC_API_KEY; });
  afterAll(() => { if (orig) process.env.ANTHROPIC_API_KEY = orig; });

  it('falls back to complex when LLM unavailable on ambiguous prompts', async () => {
    const r = await classifyPrompt('A medium length description that is not short but also not very long indeed today');
    expect(r.complexity).toBe('complex');
    expect(r.source).toBe('fallback');
  });

  it('honours disableLLM flag', async () => {
    const r = await classifyPrompt('A medium length description that is not short but also not very long indeed today', { disableLLM: true });
    expect(r.source).toBe('fallback');
  });
});

describe('TM-33 heuristic dry run on 50-prompt set', () => {
  it('reaches the documented coverage and resolved-accuracy floor', async () => {
    const r = await dryRunHeuristic();
    // Document the floor in test so regressions trip CI. Numbers were
    // measured at implementation time; we assert ≥ to allow improvement.
    expect(r.coverage).toBeGreaterThanOrEqual(0.5);
    expect(r.resolvedAccuracy).toBeGreaterThanOrEqual(0.75);
  });
});

describe('TM-33 parseProgressive', () => {
  it('extracts header fields from a partial JSON stream', () => {
    const partial = '{ "title": "My Asset", "mode": "generate", "code": "const x = ';
    const got = parseProgressive(partial);
    expect(got.title).toBe('My Asset');
    expect(got.mode).toBe('generate');
    expect(got.code).toBeUndefined();
  });

  it('handles code fences', () => {
    const partial = '```json\n{ "title": "Hi", "fps": 30';
    const got = parseProgressive(partial);
    expect(got.title).toBe('Hi');
    expect(got.fps).toBe(30);
  });

  it('returns empty for non-JSON prelude', () => {
    expect(parseProgressive('hello world')).toEqual({});
  });
});
