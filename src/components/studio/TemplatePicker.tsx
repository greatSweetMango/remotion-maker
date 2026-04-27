'use client';
import React from 'react';
import { Player } from '@remotion/player';
import { evaluateComponent } from '@/lib/remotion/evaluator';
import { Badge } from '@/components/ui/badge';
import { Sparkles } from 'lucide-react';
import type { Template } from '@/types';

interface TemplatePickerProps {
  templates: Template[];
  onSelect: (template: Template) => void;
}

const CATEGORY_GRADIENT: Record<string, string> = {
  counter: 'from-violet-900/60 to-slate-900',
  text: 'from-pink-900/60 to-slate-900',
  chart: 'from-blue-900/60 to-slate-900',
  background: 'from-emerald-900/60 to-slate-900',
  logo: 'from-amber-900/60 to-slate-900',
  composition: 'from-fuchsia-900/60 to-slate-900',
};

function TemplateThumb({ template, onSelect }: { template: Template; onSelect: () => void }) {
  const Component = evaluateComponent(template.jsCode);
  const defaultParams = Object.fromEntries(template.parameters.map(p => [p.key, p.value]));
  const gradient = CATEGORY_GRADIENT[template.category] ?? 'from-slate-800 to-slate-900';
  const midFrame = Math.floor(template.durationInFrames * 0.45);

  return (
    <button
      onClick={onSelect}
      className="group w-full text-left bg-slate-800/50 border border-slate-700 hover:border-violet-500 rounded-xl overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-violet-900/20"
      style={{ minWidth: 0 }}
    >
      <div
        className={`aspect-video bg-gradient-to-br ${gradient} relative`}
        style={{ overflow: 'hidden', contain: 'strict' }}
      >
        {Component ? (
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            <Player
              component={Component as React.ComponentType<Record<string, unknown>>}
              inputProps={defaultParams}
              durationInFrames={template.durationInFrames}
              fps={template.fps}
              compositionWidth={template.width}
              compositionHeight={template.height}
              style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
              initialFrame={midFrame}
              autoPlay
              loop
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <Sparkles className="h-6 w-6 text-slate-600" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-1">
          <span className="text-white text-sm font-semibold leading-tight">{template.title}</span>
          <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-500 capitalize flex-shrink-0">
            {template.category}
          </Badge>
        </div>
        <p className="text-slate-500 text-xs mt-0.5 leading-snug">{template.description}</p>
      </div>
    </button>
  );
}

export function TemplatePicker({ templates, onSelect }: TemplatePickerProps) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden', minWidth: 0 }}>
      <div className="px-5 pt-5 pb-3 flex-shrink-0">
        <h2 className="text-white font-semibold text-sm mb-0.5">Choose a template</h2>
        <p className="text-slate-500 text-xs">Click to open in studio · or use the prompt to generate</p>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 16px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minWidth: 0 }}>
          {templates.map(t => (
            <div key={t.id} style={{ minWidth: 0, overflow: 'hidden' }}>
              <TemplateThumb template={t} onSelect={() => onSelect(t)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
