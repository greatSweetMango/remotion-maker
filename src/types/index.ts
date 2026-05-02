export type Tier = 'FREE' | 'PRO';

export type ParameterType = 'color' | 'range' | 'text' | 'boolean' | 'select' | 'icon' | 'image' | 'font';

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

export type GenerateApiResponse =
  | { type: 'clarify'; questions: ClarifyQuestion[] }
  | { type: 'generate'; asset: GeneratedAsset };

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
  | { type: 'ADD_VERSION'; payload: AssetVersion }
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
