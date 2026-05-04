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
    retry,
    dismissError,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useStudio(initialAsset);
  const [mobileTab, setMobileTab] = useState<'prompt' | 'customize' | 'export'>('prompt');

  // Sequence-aware sidebar context (TM-28). Source defaults to original code;
  // jsCode also works because the transpiler preserves Sequence JSX/createElement
  // calls — but TS source has clearer regex-able `<Sequence ...>` tags.
  const sequenceSource = state.asset?.code ?? null;

  return (
    <ActiveSequenceProvider source={sequenceSource}>
    <div className="flex flex-col h-screen bg-slate-950 overflow-hidden" style={{ maxWidth: '100vw' }}>
      {/*
        TM-98 responsive header. Below `lg` (<1024px) the brand/tier block can
        wrap and the right cluster condenses (titles + dashboard link hidden
        on small screens) so the toolbar never bleeds outside viewport on
        iPad-portrait (768px). Tested at 375 / 768 / 1280.
      */}
      <header className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 border-b border-slate-800 bg-slate-900 flex-shrink-0 min-w-0">
        <Link href="/" className="flex items-center gap-1.5 flex-shrink-0">
          <Zap className="h-5 w-5 text-violet-400" />
          <span className="font-bold text-white text-sm">EasyMake</span>
        </Link>

        <div className="flex items-center gap-1.5 ml-1 sm:ml-3 flex-shrink-0">
          {tier === 'FREE' ? (
            <>
              <span className="text-xs text-slate-400 hidden sm:inline">Free Plan</span>
              <Button asChild size="sm" className="h-7 text-xs bg-violet-600 hover:bg-violet-700 px-2 sm:px-3">
                <Link href="/pricing">Upgrade<span className="hidden sm:inline">&nbsp;to Pro</span></Link>
              </Button>
            </>
          ) : (
            <span className="text-xs text-violet-300 bg-violet-900/40 px-2 py-0.5 rounded-full">Pro</span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 min-w-0 flex-shrink">
          {state.asset && (
            <>
              <span className="text-xs text-slate-400 hidden lg:block truncate max-w-[200px]">
                {state.asset.title}
              </span>
              {templates.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAsset}
                  className="h-7 text-xs text-slate-400 hover:text-white gap-1.5 px-2"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Templates</span>
                </Button>
              )}
              {state.asset.id && (
                <ShareButton assetId={state.asset.id} size="sm" className="h-7 text-xs" />
              )}
            </>
          )}
          {userImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={userImage} alt="" className="w-7 h-7 rounded-full border border-slate-600 flex-shrink-0" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-violet-700 flex items-center justify-center text-xs text-white flex-shrink-0">
              {userName?.[0]?.toUpperCase() ?? 'U'}
            </div>
          )}
          <Link href="/dashboard" className="text-xs text-slate-400 hover:text-white transition-colors hidden lg:block">
            Dashboard
          </Link>
        </div>
      </header>

      {/*
        TM-98: gate the 3-pane desktop layout on `lg` (>=1024px) — at 768px
        (iPad portrait) the right panel was getting cropped because 22%+52%+26%
        of 768 leaves no slack for resize handles + min-content of inner
        toolbars. iPad now uses the mobile/tablet layout below.
      */}
      <div className="flex-1 overflow-hidden hidden lg:block">
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
                errorMessage={state.error}
                canRetry={!!state.lastFailed}
                onRetry={retry}
                onDismissError={dismissError}
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
                    onUndo={undo}
                    onRedo={redo}
                    canUndo={canUndo}
                    canRedo={canRedo}
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

      {/*
        TM-98 mobile/tablet stack (<1024px). Player is now persistently mounted
        on top so its measured size is never 0×0 on first load (previous code
        only rendered it under the Customize tab, which produced an unresponsive
        Customize tab when the user landed there without any prior layout pass).
        The bottom region swaps between Prompt / Customize / Export per tab.
        TemplatePicker takes over when there's no asset and templates exist.
      */}
      <div className="flex-1 overflow-hidden lg:hidden flex flex-col min-h-0">
        {!state.asset && templates.length > 0 ? (
          <div className="flex-1 overflow-y-auto min-h-0">
            <TemplatePicker templates={templates} onSelect={initTemplate} />
          </div>
        ) : (
          <>
            <div className="flex-shrink-0 border-b border-slate-800 h-[40vh] sm:h-[45vh] min-h-[200px]">
              <PlayerPanel
                asset={state.asset}
                paramValues={state.paramValues as Record<string, unknown>}
                isGenerating={state.isGenerating}
              />
            </div>
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
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
                  errorMessage={state.error}
                  canRetry={!!state.lastFailed}
                  onRetry={retry}
                  onDismissError={dismissError}
                />
              )}
              {mobileTab === 'customize' && (
                <div className="flex-1 overflow-y-auto min-h-0">
                  <CustomizePanel
                    parameters={state.asset?.parameters ?? []}
                    paramValues={state.paramValues}
                    onParamChange={updateParam}
                    tier={tier}
                    onUndo={undo}
                    onRedo={redo}
                    canUndo={canUndo}
                    canRedo={canRedo}
                  />
                </div>
              )}
              {mobileTab === 'export' && (
                <div className="flex-1 overflow-y-auto min-h-0">
                  <ExportPanel
                    asset={state.asset}
                    paramValues={state.paramValues}
                    tier={tier}
                  />
                </div>
              )}
            </div>
          </>
        )}

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
