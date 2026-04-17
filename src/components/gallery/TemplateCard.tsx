'use client';
import React, { useState } from 'react';
import { Player } from '@remotion/player';
import { evaluateComponent } from '@/lib/remotion/evaluator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Sparkles } from 'lucide-react';
import type { Template } from '@/types';
import Link from 'next/link';

interface TemplateCardProps {
  template: Template;
}

export function TemplateCard({ template }: TemplateCardProps) {
  const [hovered, setHovered] = useState(false);

  const defaultParams = Object.fromEntries(
    template.parameters.map(p => [p.key, p.value])
  );
  const Component = evaluateComponent(template.jsCode);

  return (
    <div
      className="group relative bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden hover:border-violet-500 transition-all duration-300 hover:shadow-[0_0_20px_rgba(124,58,237,0.15)]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="aspect-video bg-slate-900 relative overflow-hidden">
        {Component ? (
          <Player
            component={Component as React.ComponentType<Record<string, unknown>>}
            inputProps={defaultParams}
            durationInFrames={template.durationInFrames}
            fps={template.fps}
            compositionWidth={template.width}
            compositionHeight={template.height}
            style={{ width: '100%', height: '100%' }}
            autoPlay={hovered}
            loop
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <Play className="h-8 w-8 text-slate-600" />
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-white font-semibold text-sm">{template.title}</h3>
            <p className="text-slate-400 text-xs mt-0.5">{template.description}</p>
          </div>
          <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400 flex-shrink-0 capitalize">
            {template.category}
          </Badge>
        </div>

        <div className="flex gap-2 mt-3">
          <Button asChild size="sm" className="flex-1 bg-violet-600 hover:bg-violet-700 text-xs h-8">
            <Link href={`/studio?template=${template.id}`}>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Use Template
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
