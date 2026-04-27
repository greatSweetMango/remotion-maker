'use client';
import { useReducer, useCallback } from 'react';
import type {
  AssetVersion,
  GeneratedAsset,
  StudioState,
  StudioAction,
  Template,
  ClarifyAnswers,
} from '@/types';
import { toast } from 'sonner';

function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'SET_GENERATING':
      return { ...state, isGenerating: action.payload, error: null };
    case 'SET_EDITING':
      return { ...state, isEditing: action.payload };
    case 'SET_EXPORTING':
      return { ...state, isExporting: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, isGenerating: false, isEditing: false };
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
      };
    }
    case 'UPDATE_PARAM':
      return {
        ...state,
        paramValues: { ...state.paramValues, [action.payload.key]: action.payload.value },
      };
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

const initialState: StudioState = {
  asset: null,
  versions: [],
  currentVersionIndex: -1,
  paramValues: {},
  isGenerating: false,
  isEditing: false,
  isExporting: false,
  error: null,
  clarify: null,
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
      toast.success('Animation created!');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      dispatch({ type: 'SET_ERROR', payload: message });
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
      const message = err instanceof Error ? err.message : 'Edit failed';
      dispatch({ type: 'SET_ERROR', payload: message });
      toast.error(message);
    }
  }, [state.asset]);

  const updateParam = useCallback((key: string, value: string | number | boolean) => {
    dispatch({ type: 'UPDATE_PARAM', payload: { key, value } });
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
  };
}
