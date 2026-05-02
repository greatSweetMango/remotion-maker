'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, Send, RotateCcw, ChevronDown, ChevronUp, Loader2, HelpCircle, Shuffle, Pencil, Plus, GitBranch, List } from 'lucide-react';
import type { AssetVersion, ClarifyAnswers, ClarifyQuestion, Tier } from '@/types';
import { HistoryGraph } from './HistoryGraph';
import { TIER_LIMITS } from '@/lib/usage';
import {
  CATEGORY_LABELS,
  pickDiversifiedSuggestions,
  type PromptSuggestion,
} from '@/lib/prompt-suggestions';

interface PromptPanelProps {
  onGenerate: (prompt: string) => void;
  onEdit: (prompt: string) => void;
  versions: AssetVersion[];
  currentVersionIndex: number;
  onRestoreVersion: (index: number) => void;
  isGenerating: boolean;
  isEditing: boolean;
  hasAsset: boolean;
  tier: Tier;
  clarify?: { questions: ClarifyQuestion[]; pendingPrompt: string } | null;
  onSubmitClarifyAnswers?: (answers: ClarifyAnswers) => void;
  onSkipClarify?: () => void;
}

const SUGGESTION_CARD_COUNT = 4;

/**
 * Pure helper — derives the effective prompt mode from `hasAsset` and the user's
 * explicit override.
 *
 * Rules:
 *  - No asset → always `'generate'` (Edit makes no sense without something to edit).
 *  - Asset present + no user override → default to `'edit'`.
 *  - Asset present + user override → honor the override.
 *
 * Keeping this as a pure function (instead of `useState` + `useEffect(setMode…)`) avoids
 * the React 19 "set-state-in-effect" lint warning that surfaced in TM-13/14 retrospectives.
 */
export type PromptMode = 'generate' | 'edit';
export function effectiveMode(hasAsset: boolean, userOverride: PromptMode | null): PromptMode {
  if (!hasAsset) return 'generate';
  return userOverride ?? 'edit';
}

interface ClarifyCardProps {
  questions: ClarifyQuestion[];
  pendingPrompt: string;
  isGenerating: boolean;
  onSubmit: (answers: ClarifyAnswers) => void;
  onSkip: () => void;
}

function ClarifyCard({ questions, pendingPrompt, isGenerating, onSubmit, onSkip }: ClarifyCardProps) {
  const [answers, setAnswers] = useState<ClarifyAnswers>({});
  const allAnswered = questions.every((q) => answers[q.id]);

  return (
    <div className="px-4 py-3 border-b border-slate-700 bg-violet-950/30">
      <div className="flex items-center gap-1.5 mb-2">
        <HelpCircle className="h-3.5 w-3.5 text-violet-300" />
        <span className="text-xs font-semibold text-violet-200">조금만 더 알려주세요</span>
      </div>
      <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
        {`"${pendingPrompt}" — 더 정확한 결과를 위해 선택해 주세요.`}
      </p>
      <div className="flex flex-col gap-3">
        {questions.map((q) => {
          const selected = answers[q.id];
          return (
            <div key={q.id} className="flex flex-col gap-1.5">
              <p className="text-xs text-slate-200">{q.question}</p>
              <div className="flex flex-wrap gap-1.5">
                {q.choices.map((c) => {
                  const isOn = selected === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: c.id }))}
                      disabled={isGenerating}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        isOn
                          ? 'bg-violet-600 border-violet-500 text-white'
                          : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <Button
          type="button"
          size="sm"
          disabled={isGenerating || !allAnswered}
          onClick={() => onSubmit(answers)}
          className="bg-violet-600 hover:bg-violet-700 h-7 text-xs flex-1"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              생성 중...
            </>
          ) : (
            '답변하고 생성'
          )}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isGenerating}
          onClick={onSkip}
          className="h-7 text-xs text-slate-400 hover:text-white"
        >
          건너뛰기
        </Button>
      </div>
    </div>
  );
}

export function PromptPanel({
  onGenerate, onEdit, versions, currentVersionIndex,
  onRestoreVersion, isGenerating, isEditing, hasAsset, tier,
  clarify, onSubmitClarifyAnswers, onSkipClarify,
}: PromptPanelProps) {
  const [prompt, setPrompt] = useState('');
  // User-explicit override; `null` means "follow default for current hasAsset state".
  // When hasAsset flips false→true we keep this as null so the default ('edit') applies;
  // when the user clicks New/Edit we record their intent here.
  const [modeOverride, setModeOverride] = useState<PromptMode | null>(null);
  const mode = effectiveMode(hasAsset, modeOverride);
  const [showHistory, setShowHistory] = useState(false);
  const [historyView, setHistoryView] = useState<'list' | 'graph'>('graph');
  const [suggestionSeed, setSuggestionSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = React.useMemo<PromptSuggestion[]>(
    () => pickDiversifiedSuggestions(SUGGESTION_CARD_COUNT, suggestionSeed),
    [suggestionSeed]
  );

  function applySuggestion(s: PromptSuggestion) {
    setPrompt(s.prompt);
    // Auto-focus the textarea after the value lands so the user can keep typing/editing.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  const isLoading = isGenerating || isEditing;
  const editCount = versions.length > 0 ? versions.length - 1 : 0;
  const editLimit = tier === 'FREE' ? TIER_LIMITS.FREE.editsPerAsset : '∞';

  function submit() {
    if (!prompt.trim() || isLoading) return;
    if (mode === 'generate') {
      onGenerate(prompt.trim());
    } else {
      onEdit(prompt.trim());
    }
    setPrompt('');
  }

  const selectGenerate = useCallback(() => setModeOverride('generate'), []);
  const selectEdit = useCallback(() => {
    // Only meaningful when an asset exists; effectiveMode will clamp regardless.
    setModeOverride('edit');
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  // Panel-scoped shortcuts: ⌘+N → Generate new, ⌘+E → Edit current.
  // Scoped to the panel container (not window) to avoid hijacking ⌘+N globally;
  // only fires while focus is inside the panel (textarea, buttons, etc.).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'n') {
        e.preventDefault();
        setModeOverride('generate');
        requestAnimationFrame(() => textareaRef.current?.focus());
      } else if (key === 'e' && hasAsset) {
        e.preventDefault();
        setModeOverride('edit');
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [hasAsset]);

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-slate-900">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700">
        <Sparkles className="h-4 w-4 text-violet-400" />
        <span className="text-sm font-semibold text-white">Prompt</span>
        {hasAsset ? (
          <div
            className="ml-auto flex items-center gap-1"
            role="radiogroup"
            aria-label="Prompt mode"
          >
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'edit'}
              onClick={selectEdit}
              title="Edit current asset (⌘E)"
              className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border transition-colors ${
                mode === 'edit'
                  ? 'bg-violet-700 border-violet-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:border-slate-600'
              }`}
            >
              <Pencil className="h-3 w-3" aria-hidden />
              <span>Edit current</span>
              {tier === 'FREE' && (
                <span className={mode === 'edit' ? 'text-violet-100' : 'text-slate-400'}>({editCount}/{editLimit})</span>
              )}
              <kbd className={`ml-1 hidden sm:inline-block text-[10px] ${mode === 'edit' ? 'text-white' : 'text-slate-300'}`}>⌘E</kbd>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'generate'}
              onClick={selectGenerate}
              title="Generate a new asset (⌘N)"
              className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border transition-colors ${
                mode === 'generate'
                  ? 'bg-emerald-700 border-emerald-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:border-slate-600'
              }`}
            >
              <Plus className="h-3 w-3" aria-hidden />
              <span>Generate new</span>
              <kbd className={`ml-1 hidden sm:inline-block text-[10px] ${mode === 'generate' ? 'text-white' : 'text-slate-300'}`}>⌘N</kbd>
            </button>
          </div>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-emerald-300/80">
            <Plus className="h-3 w-3" aria-hidden />
            Generate new
          </span>
        )}
      </div>

      {hasAsset && (
        <p
          className={`px-4 py-2 text-[11px] border-b border-slate-700 leading-relaxed ${
            mode === 'edit' ? 'text-violet-200/80 bg-violet-950/20' : 'text-emerald-200/80 bg-emerald-950/20'
          }`}
          aria-live="polite"
        >
          {mode === 'edit'
            ? 'Editing the current asset — your prompt will tweak what you see.'
            : 'Generating a brand-new asset — this will replace the current one.'}
        </p>
      )}

      {versions.length > 1 && (
        <div className="border-b border-slate-700">
          <div className="flex items-center gap-1 px-1">
            <button
              onClick={() => setShowHistory(v => !v)}
              className="flex-1 flex items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors rounded"
            >
              <RotateCcw className="h-3 w-3" />
              Version history ({versions.length})
              {showHistory ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
            </button>
            {showHistory && (
              <button
                onClick={() => setHistoryView(v => v === 'graph' ? 'list' : 'graph')}
                className="px-2 py-2 text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors rounded"
                aria-label={`Switch to ${historyView === 'graph' ? 'list' : 'graph'} view`}
                title={`Switch to ${historyView === 'graph' ? 'list' : 'graph'} view`}
              >
                {historyView === 'graph' ? <List className="h-3.5 w-3.5" /> : <GitBranch className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          {showHistory && historyView === 'graph' && (
            <HistoryGraph
              versions={versions}
              currentVersionIndex={currentVersionIndex}
              onRestoreVersion={onRestoreVersion}
            />
          )}
          {showHistory && historyView === 'list' && (
            <ScrollArea className="max-h-48">
              {[...versions].reverse().map((version, reversedIdx) => {
                const idx = versions.length - 1 - reversedIdx;
                const isCurrent = idx === currentVersionIndex;
                return (
                  <button
                    key={version.id}
                    onClick={() => onRestoreVersion(idx)}
                    className={`w-full text-left px-4 py-2 text-xs transition-colors ${
                      isCurrent ? 'bg-violet-900/30 text-violet-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <span className="text-slate-500 mr-2">v{idx + 1}</span>
                    <span className="truncate">{version.prompt}</span>
                    {isCurrent && <Badge className="ml-2 text-[10px] bg-violet-600 py-0">current</Badge>}
                  </button>
                );
              })}
            </ScrollArea>
          )}
        </div>
      )}

      {clarify && clarify.questions.length > 0 && (
        <ClarifyCard
          key={clarify.pendingPrompt}
          questions={clarify.questions}
          pendingPrompt={clarify.pendingPrompt}
          isGenerating={isGenerating}
          onSubmit={(answers) => onSubmitClarifyAnswers?.(answers)}
          onSkip={() => onSkipClarify?.()}
        />
      )}

      {!hasAsset && !clarify && prompt.trim().length === 0 && (
        <div className="px-4 py-3 border-b border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-500">Try a suggestion:</p>
            <button
              type="button"
              onClick={() => setSuggestionSeed(Math.floor(Math.random() * 1_000_000))}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-violet-300 transition-colors"
              aria-label="Shuffle suggestions"
            >
              <Shuffle className="h-3 w-3" />
              Shuffle
            </button>
          </div>
          <div
            className="grid grid-cols-2 gap-1.5"
            role="list"
            aria-label="Prompt suggestions"
          >
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => applySuggestion(s)}
                role="listitem"
                title={s.prompt}
                className="group flex flex-col gap-1 text-left bg-slate-800 hover:bg-slate-700 hover:border-violet-500/60 border border-slate-600 rounded-md px-2.5 py-2 transition-colors"
              >
                <span className="text-[10px] uppercase tracking-wider text-violet-300/80 group-hover:text-violet-200">
                  {CATEGORY_LABELS[s.category]}
                </span>
                <span className="text-xs text-slate-200 leading-snug line-clamp-2">
                  {s.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col p-4 gap-3">
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === 'generate'
              ? 'Describe your animation...\ne.g. "Animated counter from 0 to 1000 with spring physics"'
              : 'Describe your changes...\ne.g. "Make the color blue and add a glow effect"'
          }
          className="flex-1 resize-none bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 min-h-[120px]"
          disabled={isLoading}
        />
        <Button
          type="submit"
          disabled={!prompt.trim() || isLoading}
          className={`w-full disabled:opacity-50 ${
            mode === 'edit'
              ? 'bg-violet-600 hover:bg-violet-700'
              : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {isGenerating ? 'Generating...' : 'Editing...'}
            </>
          ) : (
            <>
              {mode === 'edit' ? (
                <Pencil className="h-4 w-4 mr-2" aria-hidden />
              ) : (
                <Plus className="h-4 w-4 mr-2" aria-hidden />
              )}
              {mode === 'edit' ? 'Apply changes' : 'Generate new'}
              <Send className="h-3.5 w-3.5 ml-2 opacity-70" aria-hidden />
              <span className="ml-auto text-xs opacity-60">⌘↵</span>
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
