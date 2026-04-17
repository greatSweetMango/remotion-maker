'use client';
import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, Send, RotateCcw, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { AssetVersion, Tier } from '@/types';
import { TIER_LIMITS } from '@/lib/usage';

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
}

const EXAMPLE_PROMPTS = [
  'Animated counter from 0 to 100 with spring effect',
  'Comic book explosion effect text: POW!',
  'Animated bar chart showing monthly revenue',
  'Gradient blob background animation',
  'Logo reveal with particle effect',
  'Neon text glow animation',
];

export function PromptPanel({
  onGenerate, onEdit, versions, currentVersionIndex,
  onRestoreVersion, isGenerating, isEditing, hasAsset, tier,
}: PromptPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'generate' | 'edit'>('generate');
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (hasAsset) setMode('edit');
  }, [hasAsset]);

  const isLoading = isGenerating || isEditing;
  const editCount = versions.length > 0 ? versions.length - 1 : 0;
  const editLimit = tier === 'FREE' ? TIER_LIMITS.FREE.editsPerAsset : '∞';

  function submit() {
    if (!prompt.trim() || isLoading) return;
    if (mode === 'generate' || !hasAsset) {
      onGenerate(prompt.trim());
    } else {
      onEdit(prompt.trim());
    }
    setPrompt('');
  }

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

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700">
        <Sparkles className="h-4 w-4 text-violet-400" />
        <span className="text-sm font-semibold text-white">Prompt</span>
        {hasAsset && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setMode('generate')}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${mode === 'generate' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              New
            </button>
            <button
              onClick={() => setMode('edit')}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${mode === 'edit' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Edit {tier === 'FREE' && `(${editCount}/${editLimit})`}
            </button>
          </div>
        )}
      </div>

      {versions.length > 1 && (
        <div className="border-b border-slate-700">
          <button
            onClick={() => setShowHistory(v => !v)}
            className="flex items-center gap-2 w-full px-4 py-2 text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Version history ({versions.length})
            {showHistory ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </button>
          {showHistory && (
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

      {!hasAsset && (
        <div className="px-4 py-3 border-b border-slate-700">
          <p className="text-xs text-slate-500 mb-2">Try an example:</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_PROMPTS.slice(0, 3).map(p => (
              <button
                key={p}
                onClick={() => setPrompt(p)}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-full border border-slate-600 transition-colors"
              >
                {p}
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
            mode === 'generate' || !hasAsset
              ? 'Describe your animation...\ne.g. "Animated counter from 0 to 1000 with spring physics"'
              : 'Describe your changes...\ne.g. "Make the color blue and add a glow effect"'
          }
          className="flex-1 resize-none bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 min-h-[120px]"
          disabled={isLoading}
        />
        <Button
          type="submit"
          disabled={!prompt.trim() || isLoading}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {isGenerating ? 'Generating...' : 'Editing...'}
            </>
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" />
              {mode === 'generate' || !hasAsset ? 'Generate' : 'Apply Changes'}
              <span className="ml-auto text-xs opacity-60">⌘↵</span>
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
