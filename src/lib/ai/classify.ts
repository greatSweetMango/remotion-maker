import Anthropic from '@anthropic-ai/sdk';

/**
 * Prompt complexity classifier (TM-33).
 *
 * Two-tier: a fast heuristic short-circuits the obvious cases at zero cost,
 * and an optional Haiku call resolves the ambiguous middle. The Haiku call
 * is JSON-mode-ish (single-token bias) to keep latency under ~300ms p50.
 *
 * Hypothesis target: classifier accuracy ≥ 85% on a 50-prompt eval set.
 */

export type Complexity = 'simple' | 'complex';

export interface ClassifyResult {
  complexity: Complexity;
  source: 'heuristic' | 'haiku' | 'fallback';
  /** Wall-clock ms spent classifying. */
  latencyMs: number;
  /** Confidence in [0,1]. Heuristic returns 1 only on strong signals. */
  confidence: number;
}

/**
 * Pure heuristic classifier — no network call. Returns null if uncertain.
 *
 * Rationale: ~60% of real prompts in the gallery are short single-shape
 * asks ("a red bouncing circle") OR explicitly multi-stage ("intro + 3
 * scenes with text and ..."). The middle band is the only case worth
 * spending an LLM call on.
 */
export function classifyHeuristic(prompt: string): ClassifyResult | null {
  const start = Date.now();
  const trimmed = prompt.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const sentenceCount = (trimmed.match(/[.!?。！？]/g) ?? []).length || 1;
  const hasListMarker = /(^|\n)\s*([-*]|\d+[.)])\s/.test(trimmed);
  const hasMultiSceneWords =
    /\b(scene|sequence|step|stage|then|after that|next|chapter|word-by-word|line by line|side-by-side|process flow|comparison|장면|순서|단계|순차|차례)\b/i.test(
      trimmed,
    );
  const hasComplexNouns =
    /\b(timeline|graph|chart|dashboard|infographic|particle|physics|3d|orbit|pyramid|grid of|flow|race|피라미드|그리드)\b/i.test(
      trimmed,
    );
  // Korean count markers like "3가지", "5개" almost always mean multi-element
  const hasKoreanCount = /\d+\s*(가지|개|단계|단)/.test(trimmed);
  // English explicit "N <noun>" enumerations like "4 boxes", "6 icons"
  const hasEnumCount = /\b([3-9]|[1-9]\d+)\s+(boxes?|icons?|items?|slices?|panels?|tiles?|brands?|features?|steps?|dots?|squares?|circles?|stars?|bars?|lines?|columns?|rows?|sections?)/i.test(
    trimmed,
  );

  // Very short, single sentence, no multi-element markers → simple.
  if (
    wordCount <= 12 &&
    sentenceCount <= 1 &&
    !hasListMarker &&
    !hasMultiSceneWords &&
    !hasComplexNouns &&
    !hasKoreanCount &&
    !hasEnumCount
  ) {
    return {
      complexity: 'simple',
      source: 'heuristic',
      latencyMs: Date.now() - start,
      confidence: 0.95,
    };
  }

  // Long, multi-sentence, list, multi-element, or scene-orchestration words → complex.
  if (
    wordCount > 40 ||
    sentenceCount >= 3 ||
    hasListMarker ||
    hasMultiSceneWords ||
    hasComplexNouns ||
    hasKoreanCount ||
    hasEnumCount
  ) {
    return {
      complexity: 'complex',
      source: 'heuristic',
      latencyMs: Date.now() - start,
      confidence: 0.9,
    };
  }

  return null; // ambiguous — defer to Haiku
}

const CLASSIFIER_SYSTEM = `You classify Remotion video-prompt complexity.

Rules:
- "simple" = a single visual element / one short scene / no orchestration.
- "complex" = multiple scenes, lists, charts, timelines, particle systems, 3D, or ≥3 distinct visual sections.

Output exactly one word: simple OR complex. No prose, no JSON.`;

/**
 * LLM-backed classifier. Uses Haiku with very tight max_tokens for speed.
 * Falls back to "complex" on parse failure (safe default — slower path).
 */
export async function classifyWithHaiku(
  prompt: string,
  opts?: { model?: string; client?: Anthropic },
): Promise<ClassifyResult> {
  const start = Date.now();
  const model = opts?.model ?? process.env.AI_MODEL_CLASSIFIER ?? 'claude-haiku-4-5-20251001';
  const client = opts?.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const res = await client.messages.create({
      model,
      max_tokens: 4,
      system: CLASSIFIER_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    const text =
      res.content[0]?.type === 'text' ? res.content[0].text.trim().toLowerCase() : '';
    if (text.startsWith('simple')) {
      return {
        complexity: 'simple',
        source: 'haiku',
        latencyMs: Date.now() - start,
        confidence: 0.85,
      };
    }
    if (text.startsWith('complex')) {
      return {
        complexity: 'complex',
        source: 'haiku',
        latencyMs: Date.now() - start,
        confidence: 0.85,
      };
    }
  } catch {
    // fall through
  }
  return {
    complexity: 'complex',
    source: 'fallback',
    latencyMs: Date.now() - start,
    confidence: 0.4,
  };
}

/**
 * Top-level classifier: heuristic first, Haiku for the ambiguous middle.
 *
 * `disableLLM` skips the Haiku call entirely — used in tests, local dev,
 * and when no API key is configured.
 */
export async function classifyPrompt(
  prompt: string,
  opts?: { disableLLM?: boolean; client?: Anthropic; model?: string },
): Promise<ClassifyResult> {
  const heur = classifyHeuristic(prompt);
  if (heur) return heur;
  if (opts?.disableLLM || !process.env.ANTHROPIC_API_KEY) {
    return {
      complexity: 'complex',
      source: 'fallback',
      latencyMs: 0,
      confidence: 0.5,
    };
  }
  return classifyWithHaiku(prompt, { client: opts?.client, model: opts?.model });
}
