'use client';
import { useReducer, useCallback, useEffect } from 'react';
import type {
  AssetVersion,
  GeneratedAsset,
  StudioState,
  StudioAction,
  Template,
  ClarifyAnswers,
} from '@/types';
import { toast } from 'sonner';

/**
 * Maximum number of undo steps retained for customize-panel parameter edits.
 * When exceeded the oldest entry is dropped from `past` (FIFO). 100 picked as
 * a balance between memory (each entry is a shallow params snapshot, ~few KB)
 * and user expectation. See TM-91.
 */
export const HISTORY_DEPTH = 100;

const emptyHistory = (): StudioState['history'] => ({ past: [], future: [] });

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'SET_GENERATING':
      return { ...state, isGenerating: action.payload, error: null };
    case 'SET_EDITING':
      return { ...state, isEditing: action.payload };
    case 'SET_EXPORTING':
      return { ...state, isExporting: action.payload };
    case 'SET_ERROR': {
      // TM-82 — accept either a bare string (legacy) or an object that
      // also carries `lastFailed` so the UI can render a Retry affordance.
      const payload = action.payload;
      const message =
        typeof payload === 'string' || payload === null ? payload : payload.message;
      const lastFailed =
        typeof payload === 'string' || payload === null
          ? state.lastFailed
          : payload.lastFailed ?? state.lastFailed;
      return {
        ...state,
        error: message,
        lastFailed,
        isGenerating: false,
        isEditing: false,
      };
    }
    case 'CLEAR_ERROR':
      return { ...state, error: null, lastFailed: null };
    case 'SET_ASSET': {
      const paramValues: Record<string, string | number | boolean> = {};
      for (const p of action.payload.parameters) {
        paramValues[p.key] = p.value;
      }
      return {
        ...state,
        asset: action.payload,
        paramValues,
        versions: [{
          id: action.payload.id,
          code: action.payload.code,
          jsCode: action.payload.jsCode,
          parameters: action.payload.parameters,
          prompt: '(initial)',
          createdAt: new Date().toISOString(),
          parentId: null,
        }],
        currentVersionIndex: 0,
        isGenerating: false,
        isEditing: false,
        error: null,
        // Reset history — parameter SET differs across assets; cross-asset
        // undo would resurrect keys that no longer exist.
        history: emptyHistory(),
      };
    }
    case 'UPDATE_PARAM': {
      const prev = state.paramValues[action.payload.key];
      // No-op writes don't pollute history (avoids accidental dup pushes
      // from controlled-input rerenders).
      if (prev === action.payload.value) return state;
      const past = [...state.history.past, state.paramValues];
      // Cap depth: drop oldest from front when exceeding HISTORY_DEPTH.
      if (past.length > HISTORY_DEPTH) past.shift();
      return {
        ...state,
        paramValues: { ...state.paramValues, [action.payload.key]: action.payload.value },
        // Branch — any new edit invalidates the redo stack.
        history: { past, future: [] },
      };
    }
    case 'UNDO': {
      const { past, future } = state.history;
      if (past.length === 0) return state;
      const previous = past[past.length - 1]!;
      return {
        ...state,
        paramValues: previous,
        history: {
          past: past.slice(0, -1),
          future: [state.paramValues, ...future],
        },
      };
    }
    case 'REDO': {
      const { past, future } = state.history;
      if (future.length === 0) return state;
      const next = future[0]!;
      return {
        ...state,
        paramValues: next,
        history: {
          past: [...past, state.paramValues],
          future: future.slice(1),
        },
      };
    }
    case 'ADD_VERSION': {
      // Parent = whatever version is currently active. If the user just
      // restored an older version, this naturally produces a branch.
      const currentVersion = state.versions[state.currentVersionIndex];
      const versionWithParent: AssetVersion = {
        ...action.payload,
        parentId:
          action.payload.parentId !== undefined
            ? action.payload.parentId
            : currentVersion?.id ?? null,
      };
      const newVersions = [...state.versions, versionWithParent];
      const paramValues: Record<string, string | number | boolean> = {};
      for (const p of versionWithParent.parameters) {
        paramValues[p.key] = p.value;
      }
      return {
        ...state,
        asset: state.asset ? {
          ...state.asset,
          code: action.payload.code,
          jsCode: action.payload.jsCode,
          parameters: action.payload.parameters,
        } : state.asset,
        paramValues,
        versions: newVersions,
        currentVersionIndex: newVersions.length - 1,
        isEditing: false,
        // New version = new parameter set; reset undo history.
        history: emptyHistory(),
      };
    }
    case 'RESTORE_VERSION': {
      const version = state.versions[action.payload];
      if (!version) return state;
      const paramValues: Record<string, string | number | boolean> = {};
      for (const p of version.parameters) {
        paramValues[p.key] = p.value;
      }
      return {
        ...state,
        asset: state.asset ? {
          ...state.asset,
          code: version.code,
          jsCode: version.jsCode,
          parameters: version.parameters,
        } : state.asset,
        paramValues,
        currentVersionIndex: action.payload,
        // Reset history on version restore (parameter set may differ).
        history: emptyHistory(),
      };
    }
    case 'SET_CLARIFY':
      return {
        ...state,
        clarify: { questions: action.payload.questions, pendingPrompt: action.payload.prompt },
        isGenerating: false,
        error: null,
      };
    case 'CLEAR_CLARIFY':
      return { ...state, clarify: null };
    case 'CLEAR_ASSET':
      return { ...initialState };
    default:
      return state;
  }
}

export const initialState: StudioState = {
  asset: null,
  versions: [],
  currentVersionIndex: -1,
  paramValues: {},
  isGenerating: false,
  isEditing: false,
  isExporting: false,
  error: null,
  lastFailed: null,
  clarify: null,
  history: { past: [], future: [] },
};

export function useStudio(initialAsset?: GeneratedAsset | null) {
  const [state, dispatch] = useReducer(studioReducer, {
    ...initialState,
    ...(initialAsset
      ? {
          asset: initialAsset,
          paramValues: Object.fromEntries(
            initialAsset.parameters.map((p) => [p.key, p.value]),
          ),
          versions: [
            {
              id: initialAsset.id,
              code: initialAsset.code,
              jsCode: initialAsset.jsCode,
              parameters: initialAsset.parameters,
              prompt: '(loaded)',
              createdAt: new Date().toISOString(),
              parentId: null,
            },
          ],
          currentVersionIndex: 0,
        }
      : {}),
  });

  const generate = useCallback(async (prompt: string, answers?: ClarifyAnswers) => {
    dispatch({ type: 'SET_GENERATING', payload: true });
    dispatch({ type: 'CLEAR_CLARIFY' });
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, ...(answers ? { answers } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');

      if (data.type === 'clarify') {
        dispatch({ type: 'SET_CLARIFY', payload: { questions: data.questions, prompt } });
        return;
      }
      // type === 'generate' (or legacy plain asset shape)
      const asset = data.type === 'generate' ? data.asset : data;
      dispatch({ type: 'SET_ASSET', payload: asset });
      // TM-100: when the AI repeatedly returned placeholders the server falls
      // back to a default template and tags the response with `warning`. We
      // show a softer toast so the user knows to refine the prompt.
      if (data.type === 'generate' && data.warning) {
        toast.warning(data.warning, { duration: 8000 });
      } else {
        toast.success('Animation created!');
      }
    } catch (err: unknown) {
      // TM-82 — keep the user-facing error message AND capture the last
      // failed input so the UI can offer a Retry button. The route
      // refunds quota on 5xx / timeout, so re-issuing is safe and does
      // not double-charge.
      const message = err instanceof Error ? err.message : 'Generation failed';
      dispatch({
        type: 'SET_ERROR',
        payload: { message, lastFailed: { kind: 'generate', prompt, answers } },
      });
      toast.error(message);
    }
  }, []);

  const submitClarifyAnswers = useCallback(
    async (answers: ClarifyAnswers) => {
      const pending = state.clarify?.pendingPrompt;
      if (!pending) return;
      await generate(pending, answers);
    },
    [state.clarify, generate],
  );

  const skipClarify = useCallback(async () => {
    const pending = state.clarify?.pendingPrompt;
    if (!pending) return;
    // Send a sentinel "skip" answer so LLM forces generate mode.
    await generate(pending, { __skip__: 'true' });
  }, [state.clarify, generate]);

  const edit = useCallback(async (prompt: string) => {
    if (!state.asset) return;
    dispatch({ type: 'SET_EDITING', payload: true });
    try {
      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: state.asset.id,
          prompt,
          currentCode: state.asset.code,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Edit failed');

      dispatch({
        type: 'ADD_VERSION',
        payload: {
          id: crypto.randomUUID(),
          code: data.code,
          jsCode: data.jsCode,
          parameters: data.parameters,
          prompt,
          createdAt: new Date().toISOString(),
        },
      });
      toast.success('Animation updated!');
    } catch (err: unknown) {
      // TM-82 — capture last-failed for Retry. Edit endpoint also refunds
      // editUsage on 5xx (see api/edit/route.ts), so retry is idempotent.
      const message = err instanceof Error ? err.message : 'Edit failed';
      dispatch({
        type: 'SET_ERROR',
        payload: { message, lastFailed: { kind: 'edit', prompt } },
      });
      toast.error(message);
    }
  }, [state.asset]);

  const updateParam = useCallback((key: string, value: string | number | boolean) => {
    dispatch({ type: 'UPDATE_PARAM', payload: { key, value } });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: 'REDO' });
  }, []);

  const canUndo = state.history.past.length > 0;
  const canRedo = state.history.future.length > 0;

  // Global keyboard shortcuts: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z = redo.
  // Skips when focus is in an editable text field — typing should not be
  // hijacked by undo (the browser's own text-input undo applies there).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (target && target.isContentEditable);
      if (isEditable) return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        dispatch({ type: 'REDO' });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const restoreVersion = useCallback((index: number) => {
    dispatch({ type: 'RESTORE_VERSION', payload: index });
    toast.success('Restored to previous version');
  }, []);

  const initTemplate = useCallback((template: Template) => {
    dispatch({
      type: 'SET_ASSET',
      payload: {
        id: `template-${template.id}`,
        title: template.title,
        code: template.code,
        jsCode: template.jsCode,
        parameters: template.parameters,
        durationInFrames: template.durationInFrames,
        fps: template.fps,
        width: template.width,
        height: template.height,
      },
    });
  }, []);

  const clearAsset = useCallback(() => {
    dispatch({ type: 'CLEAR_ASSET' });
  }, []);

  // TM-82 — re-issue the last failed generate/edit. Quota was already
  // refunded by the API route on the failed attempt, so this does not
  // double-charge. UI surfaces this via PromptPanel's error banner.
  const retry = useCallback(async () => {
    const lf = state.lastFailed;
    if (!lf) return;
    if (lf.kind === 'generate') {
      await generate(lf.prompt, lf.answers);
    } else {
      await edit(lf.prompt);
    }
  }, [state.lastFailed, generate, edit]);

  const dismissError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  return {
    state,
    generate,
    edit,
    updateParam,
    restoreVersion,
    initTemplate,
    clearAsset,
    submitClarifyAnswers,
    skipClarify,
    retry,
    dismissError,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
