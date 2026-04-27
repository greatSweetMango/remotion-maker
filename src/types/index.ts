export type Tier = 'FREE' | 'PRO';

export type ParameterType = 'color' | 'range' | 'text' | 'boolean' | 'select';

export interface Parameter {
  key: string;
  label: string;
  group: 'color' | 'size' | 'timing' | 'text' | 'other';
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
  clarify: ClarifyState | null;
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
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'UPDATE_PARAM'; payload: { key: string; value: string | number | boolean } }
  | { type: 'ADD_VERSION'; payload: AssetVersion }
  | { type: 'RESTORE_VERSION'; payload: number }
  | { type: 'CLEAR_ASSET' }
  | { type: 'SET_CLARIFY'; payload: { questions: ClarifyQuestion[]; prompt: string } }
  | { type: 'CLEAR_CLARIFY' };

export interface Template {
  id: string;
  title: string;
  description: string;
  category: 'counter' | 'text' | 'chart' | 'background' | 'logo' | 'composition';
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
