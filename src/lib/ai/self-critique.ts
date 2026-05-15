/**
 * TM-138 — Vision-guided self-critique loop (arxiv 2604.05839 +17.8% quality).
 *
 * Reuses our existing infra:
 *   - TM-66 visual judge rubric (4 axes, gpt-4o multimodal)
 *   - TM-103 plugin/llm-judge `judgeVisual` (deterministic temp=0/seed=42)
 *   - TM-90/136 asset-gen PNG (the artifact actually being judged)
 *
 * Why we judge the asset-gen PNG (not a Remotion frame):
 *   ADR-0001 forbids server-side rendering on the edit path. The asset-gen
 *   PNG is the source-of-truth visual the LLM splices via `<Img src=...>`
 *   — TM-135 RCA showed the regression was the LLM IGNORING this PNG and
 *   drawing a "갈색 원" instead. So judging the PNG itself catches both
 *   classes of failure: bad PNG (regenerate with refined prompt) AND
 *   acceptable PNG (LLM injection bug → handled by TM-136 finalizer).
 *
 * Loop:
 *   1. asset-gen produces PNG `A0` for prompt `P` + answers `Q`.
 *   2. judgeVisual(A0, criteria=P) → score `S0` (0-100).
 *   3. If S0 ≥ threshold (default 70) → keep A0.
 *   4. Else: build critique prompt from judge.reasoning, regenerate ONCE
 *      → A1, judge → S1.
 *   5. Pick max(S0, S1) → return.
 *
 * Cost cap (1 cycle worst case):
 *   - 2× gpt-image-1 ($0.04 ea) + 2× gpt-4o judge ($0.005 ea) ≈ $0.09.
 *   - 1 cycle happy path: $0.04 + $0.005 ≈ $0.045.
 *
 * Env knobs:
 *   - AI_SELF_CRITIQUE=0           → disable entirely (default ON)
 *   - AI_SELF_CRITIQUE_THRESHOLD=N → score floor 0-100 (default 70)
 *   - AI_SELF_CRITIQUE_MAX_RETRY=N → max regenerations (default 1)
 */
import OpenAI from 'openai';
import { judgeVisual, type ChatLikeClient } from '../../../plugin/llm-judge/src/judge';
import { generateAssetImage } from './asset-gen';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AssetGenStageResult } from './asset-gen-stage';
import type { ClarifyAnswers } from '@/types';

export interface SelfCritiqueOptions {
  prompt: string;
  answers?: ClarifyAnswers;
  /** Initial asset-gen result (PNG already on disk + URL). REQUIRED. */
  initial: AssetGenStageResult;
  /** Disk path of the PNG (for base64 encode → judge). */
  initialDiskPath: string;
  /** Inject judge client (tests). Defaults to OpenAI from env. */
  judgeClient?: ChatLikeClient;
  /** Inject regen image generator (tests). Defaults to real OpenAI Images API. */
  imageGenerator?: typeof generateAssetImage;
  /** Override threshold (0-100). Default = env or 70. */
  threshold?: number;
  /** Override max retries. Default = env or 1. */
  maxRetry?: number;
  /** Override directory for retry PNG persistence. */
  outDir?: string;
}

export interface SelfCritiqueResult {
  /** Best PNG kept after the loop (initial OR a regeneration). */
  chosen: AssetGenStageResult;
  /** Score history per attempt (length = 1 + retries actually performed). */
  scores: number[];
  /** Per-attempt judge reasoning (for telemetry / wiki retro). */
  reasoning: string[];
  /** True when a regeneration was actually performed. */
  retried: boolean;
  /** Sum of $ spent across all extra image-gen + judge calls. */
  extraCostUsd: number;
}

const DEFAULT_THRESHOLD = 70;
const DEFAULT_MAX_RETRY = 1;
/** Approx cost of one gpt-4o judge call at our typical token volume. */
const JUDGE_CALL_COST_USD = 0.005;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function isSelfCritiqueEnabled(): boolean {
  return process.env.AI_SELF_CRITIQUE !== '0';
}

/**
 * Build a regeneration prompt from the judge's reasoning. Conservative —
 * we keep the original user prompt as the spine and append a SINGLE
 * "previous attempt failed because…" instruction so gpt-image-1 has
 * concrete ground to work with.
 */
export function buildCritiquePrompt(
  originalPrompt: string,
  judgeReasoning: string,
  answers?: ClarifyAnswers,
): string {
  const answerText = answers && Object.keys(answers).length > 0
    ? Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join(', ')
    : '';
  const tail = answerText ? ` (${answerText})` : '';
  return `${originalPrompt}${tail}.

Previous attempt was rejected by visual review with this critique: "${judgeReasoning}".
Address those issues directly. Style: friendly cartoon illustration, transparent background, soft colors, centered composition.`;
}

async function readPngAsDataUrl(diskPath: string): Promise<string> {
  const bytes = await fs.readFile(diskPath);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/**
 * Judge the initial asset; if score < threshold, regenerate with a
 * critique-augmented prompt and pick the better of the two. Never throws —
 * on any failure (judge error, regen error) returns the initial unchanged
 * with `retried=false` so the caller is never blocked.
 */
export async function judgeAndMaybeRegenerate(
  opts: SelfCritiqueOptions,
): Promise<SelfCritiqueResult> {
  const threshold = opts.threshold ?? envInt('AI_SELF_CRITIQUE_THRESHOLD', DEFAULT_THRESHOLD);
  const maxRetry = opts.maxRetry ?? envInt('AI_SELF_CRITIQUE_MAX_RETRY', DEFAULT_MAX_RETRY);

  const scores: number[] = [];
  const reasoning: string[] = [];
  let extraCostUsd = 0;

  const client: ChatLikeClient = opts.judgeClient
    ?? (new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as ChatLikeClient);

  // 1. Judge the initial PNG.
  let initialJudgement: { overall: number; reasoning: string } | null = null;
  try {
    const dataUrl = await readPngAsDataUrl(opts.initialDiskPath);
    const j = await judgeVisual(client, {
      image_url: dataUrl,
      criteria: `User wanted: "${opts.prompt}". The image must visually depict the requested subject (character/animal/person), match any color or style hints, and be free of obvious artifacts.`,
    });
    initialJudgement = { overall: j.overall, reasoning: j.reasoning };
    extraCostUsd += JUDGE_CALL_COST_USD;
    scores.push(j.overall);
    reasoning.push(j.reasoning);
  } catch (err) {
    // Judge failure → return initial unchanged. Self-critique must NEVER block.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[TM-138] judge failed on initial, keeping original:', err instanceof Error ? err.message : String(err));
    }
    return {
      chosen: opts.initial,
      scores,
      reasoning,
      retried: false,
      extraCostUsd,
    };
  }

  // 2. Above threshold → keep initial.
  if (initialJudgement.overall >= threshold) {
    return {
      chosen: opts.initial,
      scores,
      reasoning,
      retried: false,
      extraCostUsd,
    };
  }

  // 3. Below threshold → regenerate with critique-augmented prompt.
  if (maxRetry < 1) {
    return {
      chosen: opts.initial,
      scores,
      reasoning,
      retried: false,
      extraCostUsd,
    };
  }

  const critiquePrompt = buildCritiquePrompt(opts.prompt, initialJudgement.reasoning, opts.answers);
  let regenResult: AssetGenStageResult | null = null;
  let regenJudge: { overall: number; reasoning: string } | null = null;

  try {
    const gen = opts.imageGenerator ?? generateAssetImage;
    const img = await gen({ prompt: critiquePrompt });
    extraCostUsd += img.costUsd;

    // Persist regen PNG alongside the original (under same dir, distinct hash suffix).
    const outDir = opts.outDir ?? path.dirname(opts.initialDiskPath);
    await fs.mkdir(outDir, { recursive: true });
    const retryHash = `${opts.initial.hash}-r1`;
    const retryDiskPath = path.join(outDir, `${retryHash}.png`);
    await fs.writeFile(retryDiskPath, img.pngBytes);
    const retryUrl = opts.initial.imageUrl.replace(`${opts.initial.hash}.png`, `${retryHash}.png`);

    regenResult = {
      imageUrl: retryUrl,
      costUsd: img.costUsd,
      latencyMs: img.latencyMs,
      cached: false,
      hash: retryHash,
      matchedToken: opts.initial.matchedToken,
    };

    // Judge the regen.
    const regenDataUrl = `data:image/png;base64,${img.pngBytes.toString('base64')}`;
    const j2 = await judgeVisual(client, {
      image_url: regenDataUrl,
      criteria: `User wanted: "${opts.prompt}". The image must visually depict the requested subject (character/animal/person), match any color or style hints, and be free of obvious artifacts.`,
    });
    extraCostUsd += JUDGE_CALL_COST_USD;
    regenJudge = { overall: j2.overall, reasoning: j2.reasoning };
    scores.push(j2.overall);
    reasoning.push(j2.reasoning);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[TM-138] regen failed, keeping initial:', err instanceof Error ? err.message : String(err));
    }
    return {
      chosen: opts.initial,
      scores,
      reasoning,
      retried: false,
      extraCostUsd,
    };
  }

  // 4. Pick the better of the two by judge score.
  const initialBeats = !regenResult || !regenJudge || initialJudgement.overall >= regenJudge.overall;
  const chosen = initialBeats ? opts.initial : regenResult!;
  return {
    chosen,
    scores,
    reasoning,
    retried: true,
    extraCostUsd,
  };
}
