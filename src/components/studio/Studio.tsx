'use client';
import React, { useState, useEffect } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { PromptPanel } from './PromptPanel';
import { PlayerPanel } from './PlayerPanel';
import { CustomizePanel } from './CustomizePanel';
import { ExportPanel } from './ExportPanel';
import { TemplatePicker } from './TemplatePicker';
import { useStudio } from '@/hooks/useStudio';
import { ActiveSequenceProvider, useActiveSequence } from '@/hooks/useActiveSequence';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Zap, Settings2, Download, LayoutGrid } from 'lucide-react';
import { ShareButton } from '@/components/share/ShareButton';
import type { GeneratedAsset, Template, Tier } from '@/types';
import Link from 'next/link';

interface StudioProps {
  tier: Tier;
  userImage?: string | null;
  userName?: string | null;
  initialAsset?: GeneratedAsset | null;
  templates?: Template[];
}

export function Studio({ tier, userImage, userName, initialAsset, templates = [] }: StudioProps) {
  const {
    state,
    generate,
    edit,
    updateParam,
    restoreVersion,
    initTemplate,
    clearAsset,
    submitClarifyAnswers,
    skipClarify,
  } = useStudio(initialAsset);
  const [mobileTab, setMobileTab] = useState<'prompt' | 'customize' | 'export'>('prompt');

  // Sequence-aware sidebar context (TM-28). Source defaults to original code;
  // jsCode also works because the transpiler preserves Sequence JSX/createElement
  // calls — but TS source has clearer regex-able `<Sequence ...>` tags.
  const sequenceSource = state.asset?.code ?? null;

  return (
    <ActiveSequenceProvider source={sequenceSource}>
    <div className="flex flex-col h-screen bg-slate-950 overflow-hidden"style={{ maxWidth: '100vw' }}>
      <header className="flex items-center gap-3 px-4 py-2 border-b border-slate-800 bg-slate-900 flex-shrink-0">
        <Link href="/" className="flex items-center gap-1.5">
          <Zap className="h-5 w-5 text-violet-400" />
          <span className="font-bold text-white text-sm">EasyMake</span>
        </Link>

        <div className="flex items-center gap-1.5 ml-3">
          {tier === 'FREE' ? (
            <>
              <span className="text-xs text-slate-400">Free Plan</span>
              <Button asChild size="sm" className="h-7 text-xs bg-violet-600 hover:bg-violet-700 px-3">
                <Link href="/pricing">Upgrade to Pro</Link>
              </Button>
            </>
          ) : (
            <span className="text-xs text-violet-300 bg-violet-900/40 px-2 py-0.5 rounded-full">Pro</span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {state.asset && (
            <>
              <span className="text-xs text-slate-400 hidden sm:block truncate max-w-[200px]">
                {state.asset.title}
              </span>
              {templates.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAsset}
                  className="h-7 text-xs text-slate-400 hover:text-white gap-1.5"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Templates
                </Button>
              )}
              {state.asset.id && (
                <ShareButton assetId={state.asset.id} size="sm" className="h-7 text-xs" />
              )}
            </>
          )}
          {userImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={userImage} alt="" className="w-7 h-7 rounded-full border border-slate-600" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-violet-700 flex items-center justify-center text-xs text-white">
              {userName?.[0]?.toUpperCase() ?? 'U'}
            </div>
          )}
          <Link href="/dashboard" className="text-xs text-slate-400 hover:text-white transition-colors hidden sm:block">
            Dashboard
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-hidden hidden md:block">
        <PanelGroup orientation="horizontal" className="h-full">
          <Panel defaultSize="22" minSize="18" maxSize="35">
            <div className="h-full border-r border-slate-800">
              <PromptPanel
                onGenerate={generate}
                onEdit={edit}
                versions={state.versions}
                currentVersionIndex={state.currentVersionIndex}
                onRestoreVersion={restoreVersion}
                isGenerating={state.isGenerating}
                isEditing={state.isEditing}
                hasAsset={!!state.asset}
                tier={tier}
                clarify={state.clarify}
                onSubmitClarifyAnswers={submitClarifyAnswers}
                onSkipClarify={skipClarify}
              />
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-slate-800 hover:bg-violet-600 transition-colors cursor-col-resize" />

          <Panel defaultSize="52" minSize="35">
            {!state.asset && templates.length > 0 ? (
              <TemplatePicker templates={templates} onSelect={initTemplate} />
            ) : (
              <PlayerPanel
                asset={state.asset}
                paramValues={state.paramValues as Record<string, unknown>}
                isGenerating={state.isGenerating}
              />
            )}
          </Panel>

          <PanelResizeHandle className="w-1 bg-slate-800 hover:bg-violet-600 transition-colors cursor-col-resize" />

          <Panel defaultSize="26" minSize="20" maxSize="40">
            <div className="h-full border-l border-slate-800 flex flex-col">
              <Tabs defaultValue="customize" className="flex flex-col h-full">
                <TabsList className="w-full bg-slate-800 rounded-none border-b border-slate-700 flex-shrink-0">
                  <TabsTrigger value="customize" className="flex-1 text-xs data-[state=active]:bg-slate-900">
                    <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                    Customize
                  </TabsTrigger>
                  <TabsTrigger value="export" className="flex-1 text-xs data-[state=active]:bg-slate-900">
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Export
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="customize" className="flex-1 overflow-y-auto m-0">
                  <CustomizePanel
                    parameters={state.asset?.parameters ?? []}
                    paramValues={state.paramValues}
                    onParamChange={updateParam}
                    tier={tier}
                  />
                </TabsContent>

                <TabsContent value="export" className="flex-1 overflow-y-auto m-0">
                  <ExportPanel
                    asset={state.asset}
                    paramValues={state.paramValues}
                    tier={tier}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </Panel>
        </PanelGroup>
      </div>

      <div className="flex-1 overflow-hidden md:hidden flex flex-col">
        <div className="flex-1 overflow-hidden flex flex-col">
          {mobileTab === 'prompt' && (
            <PromptPanel
              onGenerate={generate}
              onEdit={edit}
              versions={state.versions}
              currentVersionIndex={state.currentVersionIndex}
              onRestoreVersion={restoreVersion}
              isGenerating={state.isGenerating}
              isEditing={state.isEditing}
              hasAsset={!!state.asset}
              tier={tier}
              clarify={state.clarify}
              onSubmitClarifyAnswers={submitClarifyAnswers}
              onSkipClarify={skipClarify}
            />
          )}
          {mobileTab === 'customize' && (
            <>
              <div className="h-64 border-b border-slate-800">
                <PlayerPanel
                  asset={state.asset}
                  paramValues={state.paramValues as Record<string, unknown>}
                  isGenerating={state.isGenerating}
                />
              </div>
              <div className="flex-1 overflow-y-auto">
                <CustomizePanel
                  parameters={state.asset?.parameters ?? []}
                  paramValues={state.paramValues}
                  onParamChange={updateParam}
                  tier={tier}
                />
              </div>
            </>
          )}
          {mobileTab === 'export' && (
            <ExportPanel
              asset={state.asset}
              paramValues={state.paramValues}
              tier={tier}
            />
          )}
        </div>

        <div className="flex border-t border-slate-800 bg-slate-900 flex-shrink-0">
          {[
            { id: 'prompt' as const, label: 'Prompt', Icon: Zap },
            { id: 'customize' as const, label: 'Customize', Icon: Settings2 },
            { id: 'export' as const, label: 'Export', Icon: Download },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setMobileTab(id)}
              className={`flex-1 flex flex-col items-center gap-1 py-2 text-xs transition-colors ${
                mobileTab === id ? 'text-violet-400' : 'text-slate-500'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <SequenceHotkeys />
    </div>
    </ActiveSequenceProvider>
  );
}

/**
 * Keyboard shortcuts for sequence navigation:
 *   - `A` toggles "All" mode (show every parameter regardless of segment)
 *   - `1`–`9` jumps the Player to sequence 1–9 (and selects it)
 *   - `Esc` resumes auto-follow (clears explicit selection)
 * Disabled when focus is inside an editable element.
 */
function SequenceHotkeys() {
  const { segments, toggleAllMode, seekToSequence, resumeAutoFollow } = useActiveSequence();
  useEffect(() => {
    if (segments.length <= 1) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const editable = target?.isContentEditable;
      if (editable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        toggleAllMode();
        return;
      }
      if (e.key === 'Escape') {
        resumeAutoFollow();
        return;
      }
      const num = parseInt(e.key, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= 9 && segments[num - 1]) {
        e.preventDefault();
        seekToSequence(segments[num - 1].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [segments, toggleAllMode, seekToSequence, resumeAutoFollow]);
  return null;
}
