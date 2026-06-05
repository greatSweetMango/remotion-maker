export type Tier = 'FREE' | 'PRO';

export type ParameterType = 'color' | 'range' | 'text' | 'boolean' | 'select' | 'icon' | 'image' | 'font' | 'bgmTrack' | 'lottie';

export interface Parameter {
  key: string;
  label: string;
  group: 'color' | 'size' | 'timing' | 'text' | 'media' | 'other';
  type: ParameterType;
  value: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
  /**
   * Sequence ids this parameter belongs to. `['global']` means always shown.
   * Optional — when absent, sequence-filtering falls back to a key-prefix
   * heuristic (`inferParamSequences`). Populated by `extractParameters` from
   * `// sequence: a|b|global` annotations on the PARAMS line.
   */
  sequenceIds?: string[];
  /**
   * TM-88 / ADR-0022 — original prompt used to generate this `type:image`
   * asset (gpt-image-1). When present, the Customize UI surfaces a
   * "Regenerate" button that pre-fills the prompt editor. The user can tweak
   * the prompt and call `/api/asset/regen-image` to mint a fresh `imageUrl`
   * (data URL or R2 key) in place. Only meaningful for `type === 'image'`.
   */
  regenPrompt?: string;
}

export interface GeneratedAsset {
  id: string;
  title: string;
  code: string;
  jsCode: string;
  parameters: Parameter[];
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

export interface AssetVersion {
  id: string;
  code: string;
  jsCode: string;
  parameters: Parameter[];
  prompt: string;
  createdAt: string;
  /**
   * id of the version this one was forked from. `null` for the root version.
   * When the user restores an older version and then edits, the new version's
   * `parentId` points at the restored one — producing a branch in the tree.
   * Older versions persisted before TM-24 may omit this field; UI treats
   * missing `parentId` as "linear chain to previous index".
   */
  parentId?: string | null;
}

/**
 * TM-82 — last-failed bookkeeping so the UI can offer a "Retry" button.
 *
 * The route already refunds quota on 5xx / timeout (api/generate +
 * api/edit catch branches), so re-issuing the same request is idempotent
 * with respect to billing. We capture just enough context to reconstruct
 * the call: which endpoint, which prompt, and (for clarify follow-ups)
 * the answers payload.
 */
export interface LastFailed {
  kind: 'generate' | 'edit';
  prompt: string;
  answers?: ClarifyAnswers;
}

export interface StudioState {
  asset: GeneratedAsset | null;
  versions: AssetVersion[];
  currentVersionIndex: number;
  paramValues: Record<string, string | number | boolean>;
  isGenerating: boolean;
  isEditing: boolean;
  isExporting: boolean;
  error: string | null;
  /** TM-82 — populated when the most recent generate/edit failed; cleared on success or dismiss. */
  lastFailed: LastFailed | null;
  clarify: ClarifyState | null;
  /**
   * Undo/redo history for customize-panel parameter edits (TM-91).
   * Each entry is a snapshot of `paramValues` taken BEFORE applying the
   * next UPDATE_PARAM. Capped at HISTORY_DEPTH; older entries drop off
   * the bottom of `past`. New UPDATE_PARAM clears `future` (branch).
   * SET_ASSET / ADD_VERSION / RESTORE_VERSION reset both stacks because
   * the parameter set itself changes — no meaningful undo across that.
   */
  history: {
    past: Array<Record<string, string | number | boolean>>;
    future: Array<Record<string, string | number | boolean>>;
  };
}

export interface ClarifyChoice {
  id: string;
  label: string;
}

export interface ClarifyQuestion {
  id: string;
  question: string;
  choices: ClarifyChoice[];
}

export interface ClarifyResponse {
  questions: ClarifyQuestion[];
}

/**
 * TM-124 — per-stage pipeline timing trace surfaced from /api/generate.
 * Client-safe type (no server deps); the pipeline module re-exports the
 * same shape under the same name for server callers.
 */
export interface PipelineTimingStage {
  name: string;
  ms: number;
  meta?: Record<string, string | number | boolean>;
}
export interface PipelineTiming {
  mode: 'multi-step' | 'single-shot';
  stages: PipelineTimingStage[];
  totalMs: number;
  asset_gen_used: boolean;
  scenes: number;
}

/**
 * TM-150 — self-critique judge metadata surfaced on the API response so
 * clients and QA can verify TM-138 actually ran (TM-149 verification could
 * not distinguish a no-op pass-through from an actual judge call).
 *
 * Populated only when the single-shot asset-gen path ran the vision-guided
 * self-critique loop (i.e. living-entity prompt + uncached PNG + the
 * `AI_SELF_CRITIQUE=0` escape hatch is NOT set). Absent otherwise.
 */
export interface SelfCritiqueMetadata {
  /** Final (kept) judge score 0-100. Equal to max of `runs[].score`. */
  score: number;
  /** Whether the regen branch fired (initial < threshold). */
  retried: boolean;
  /** Threshold the run was judged against (env or default 70). */
  threshold: number;
  /** Per-attempt score + wall-clock ms (length 1 or 2). */
  runs: Array<{ score: number; ms: number }>;
  /** Total $ spent on extra judge + regen calls (0 when judge failed before billing). */
  extraCostUsd: number;
}

/**
 * TM-171 — composition-critique metadata. TM-138 self-critique only judges
 * the asset-gen PNG; this judges the actual rendered Remotion frame, closing
 * Axis 4 of the TM-166 RCA. Present only when AI_COMPOSITION_CRITIQUE=1 and
 * the composition-critique loop actually ran on this request.
 */
export interface CompositionCritiqueMetadata {
  /** Judge score 0-100 for the snapshotted frame. */
  score: number;
  /** Threshold the score was compared against (env or 70). */
  threshold: number;
  /** True when score < threshold — composition rejected by the judge. */
  belowThreshold: boolean;
  /** Frame number that was snapshotted (default = mid). */
  frame: number;
  /** Wall-clock ms: renderStill + judge call combined. */
  latencyMs: number;
  /** $ spent on the judge call. */
  extraCostUsd: number;
}

/**
 * TM-184 — motion-liveness gate telemetry. The positive "does it actually move
 * across frames?" check. Present when the gate ran (env-gated, default on for
 * character/scene). `stage` records which axis produced the verdict; `render`
 * carries the cross-frame diff diagnostics when the render stage executed.
 * Used to log the false-positive rate offline.
 */
export interface LivenessMetadata {
  /** Final verdict for the served asset: 'live' | 'static' | 'skipped'. */
  verdict: 'live' | 'static' | 'skipped';
  /** Which stage produced the verdict ('ast' | 'render' | 'none'). */
  stage: 'ast' | 'render' | 'none';
  /** Max cross-frame mean-abs-diff (0-255) when the render stage ran. */
  maxDiff?: number;
  /** ε the diff was compared against. */
  epsilon?: number;
  /** Frames sampled by the render stage. */
  frames?: number[];
  /** Wall-clock ms for the liveness render+diff (render stage only). */
  latencyMs?: number;
}

/**
 * TM-186 — multi-frame motion-critique metadata. The qualitative motion axis
 * (motion-present + motion-quality / easing / narrative coherence) layered on
 * top of TM-184's binary liveness pixel-diff. Present when motion-critique ran
 * (opt-in / default-on gate). `categoryFloorViolated` is the ADR-0016
 * per-category min (motion ≥ 60) routed up so a collapsed motion category is
 * not hidden behind a passing overall average.
 */
export interface MotionCritiqueMetadata {
  /** Averaged motion overall score 0-100 across N runs. */
  score: number;
  /** Per-category averaged sub-scores (0-100). */
  categories: {
    motion_present: number;
    motion_quality: number;
    motion_polish: number;
    narrative_coherence: number;
  };
  /** ADR-0016 per-category floor breach (lowest motion category < min). */
  categoryFloorViolated: boolean;
  /** Lowest-scoring category when the floor was breached. */
  worstCategory: string;
  /** Per-run overall scores (ADR-0018 variance surface). */
  runs: number[];
  /** Max - min of runs (noise band). */
  deltaMax: number;
  /** Sample std of runs. */
  std: number;
  /** The two frames compared (frame0, frameN). */
  frames: [number, number];
  /** Wall-clock ms. */
  latencyMs: number;
  /** $ spent across all judge calls. */
  extraCostUsd: number;
}

/**
 * TM-187 — composition-level motion regen-loop telemetry. The TM-138 PNG
 * self-critique regen pattern applied at the COMPOSITION level: when TM-184
 * liveness is 'static' OR TM-186 motion-critique breaches the ADR-0016
 * per-category floor, the structured critique is injected into a single regen
 * of the generated CODE and the motion gate re-runs. Present when the regen
 * loop actually fired (i.e. the first pass tripped a motion gate). Records
 * whether the regen recovered motion, how many attempts ran, and the loop-guard
 * outcome so a non-recovering regen surfaces as a warning rather than a silent
 * dead video or an unbounded loop.
 */
export interface MotionRegenMetadata {
  /** True when at least one regen attempt actually ran. */
  triggered: boolean;
  /** Which gate tripped the regen: liveness 'static' or motion floor breach. */
  trigger: 'liveness-static' | 'motion-floor' | 'both';
  /** Number of regen attempts performed (0 = trigger present but guard blocked). */
  attempts: number;
  /** Max attempts allowed for this run (loop guard, 1-2). */
  maxAttempts: number;
  /** True when the final served code passed the motion gate after regen. */
  recovered: boolean;
  /** True when the loop guard (attempts/cost) was exhausted without recovery. */
  guardExhausted: boolean;
  /** $ spent across all regen LLM + re-evaluation calls. */
  extraCostUsd: number;
  /** Wall-clock ms for the whole regen loop. */
  latencyMs: number;
}

export type GenerateApiResponse =
  | { type: 'clarify'; questions: ClarifyQuestion[] }
  | {
      type: 'generate';
      asset: GeneratedAsset;
      warning?: string;
      assetGenStages?: PipelineTiming;
      /** TM-150 — present when TM-138 self-critique ran. */
      selfCritique?: SelfCritiqueMetadata;
      /** TM-171 — present when composition-critique ran. */
      compositionCritique?: CompositionCritiqueMetadata;
      /** TM-184 — present when the motion-liveness render stage ran. */
      liveness?: LivenessMetadata;
      /** TM-186 — present when multi-frame motion-critique ran. */
      motionCritique?: MotionCritiqueMetadata;
      /** TM-187 — present when the composition motion regen-loop fired. */
      motionRegen?: MotionRegenMetadata;
    };

/** Map of clarify question id → selected choice id */
export type ClarifyAnswers = Record<string, string>;

export interface ClarifyState {
  questions: ClarifyQuestion[];
  pendingPrompt: string;
}

export type StudioAction =
  | { type: 'SET_GENERATING'; payload: boolean }
  | { type: 'SET_EDITING'; payload: boolean }
  | { type: 'SET_EXPORTING'; payload: boolean }
  | { type: 'SET_ASSET'; payload: GeneratedAsset }
  | { type: 'SET_ERROR'; payload: { message: string | null; lastFailed?: LastFailed | null } | string | null }
  | { type: 'CLEAR_ERROR' }
  | { type: 'UPDATE_PARAM'; payload: { key: string; value: string | number | boolean } }
  | {
      type: 'ADD_VERSION';
      payload: AssetVersion;
      /**
       * TM-106 — when an edit on a template-backed asset materializes a new
       * DB row (server returns `id` !== `template-...`), the client must
       * adopt that id so subsequent edits route to the materialized asset
       * instead of re-creating a fresh DB row + double-debiting quota on
       * every call. Optional newAssetId/newTitle let the reducer pivot
       * `state.asset` without losing the version stack.
       */
      newAssetId?: string;
      newTitle?: string;
    }
  | { type: 'RESTORE_VERSION'; payload: number }
  | { type: 'CLEAR_ASSET' }
  | { type: 'SET_CLARIFY'; payload: { questions: ClarifyQuestion[]; prompt: string } }
  | { type: 'CLEAR_CLARIFY' }
  | { type: 'UNDO' }
  | { type: 'REDO' };

export interface Template {
  id: string;
  title: string;
  description: string;
  category: 'counter' | 'text' | 'chart' | 'background' | 'logo' | 'composition' | 'transition' | 'infographic';
  previewGif?: string;
  code: string;
  jsCode: string;
  parameters: Parameter[];
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

export type ExportFormat = 'gif' | 'mp4' | 'webm' | 'react';

export interface UsageInfo {
  monthlyGenerations: number;
  monthlyGenerationLimit: number;
  tier: Tier;
}
