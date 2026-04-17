'use client';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Download, Code, Globe, Film, Lock, Check, Copy } from 'lucide-react';
import type { GeneratedAsset, ExportFormat, Tier } from '@/types';
import { toast } from 'sonner';

interface ExportPanelProps {
  asset: GeneratedAsset | null;
  paramValues: Record<string, string | number | boolean>;
  tier: Tier;
}

interface FormatOption {
  id: ExportFormat;
  label: string;
  description: string;
  tier: 'free' | 'pro';
  Icon: React.ComponentType<{ className?: string }>;
  serverRender: boolean;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { id: 'react', label: 'React Component', description: 'Download as .tsx file', tier: 'free', Icon: Code, serverRender: false },
  { id: 'gif', label: 'Animated GIF', description: 'With watermark on Free', tier: 'free', Icon: Film, serverRender: true },
  { id: 'mp4', label: 'MP4 Video', description: '1080p H.264', tier: 'pro', Icon: Film, serverRender: true },
  { id: 'webm', label: 'WebM (Alpha)', description: 'Transparent background', tier: 'pro', Icon: Film, serverRender: true },
];

function EmbedCode({ assetId }: { assetId: string }) {
  const [copied, setCopied] = useState(false);
  const embedCode = `<script src="https://easymake.app/embed.js"></script>\n<easymake-player id="${assetId}"></easymake-player>`;

  function copy() {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Embed code copied!');
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Web Embed</span>
        <Badge variant="outline" className="text-[10px] border-green-600 text-green-400 ml-auto">Free</Badge>
      </div>
      <div className="relative bg-slate-900 rounded-md p-3 font-mono text-xs text-slate-300 break-all border border-slate-700">
        {embedCode}
        <button onClick={copy} className="absolute top-2 right-2 p-1 hover:bg-slate-700 rounded">
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
        </button>
      </div>
    </div>
  );
}

export function ExportPanel({ asset, paramValues, tier }: ExportPanelProps) {
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [progress, setProgress] = useState(0);

  if (!asset) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6 gap-2">
        <Download className="h-10 w-10 text-slate-600" />
        <p className="text-slate-400 text-sm">Generate an animation to export</p>
      </div>
    );
  }

  async function handleExport(format: ExportFormat) {
    if (!asset) return;

    if (format === 'react') {
      const blob = new Blob([asset.code], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${asset.title.replace(/\s+/g, '_')}.tsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Component downloaded!');
      return;
    }

    setExporting(format);
    setProgress(10);

    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id, format, paramValues }),
      });

      setProgress(80);

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error);
      }

      const blob = await res.blob();
      setProgress(100);

      const extMap: Record<string, string> = { gif: 'gif', mp4: 'mp4', webm: 'webm' };
      const ext = extMap[format];
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${asset.title.replace(/\s+/g, '_')}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success(`${format.toUpperCase()} downloaded!`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Export failed';
      toast.error(message);
    } finally {
      setTimeout(() => {
        setExporting(null);
        setProgress(0);
      }, 500);
    }
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <Download className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-semibold text-white">Export</span>
      </div>

      {FORMAT_OPTIONS.map(fmt => {
        const isLocked = fmt.tier === 'pro' && tier === 'FREE';
        const isExportingThis = exporting === fmt.id;

        return (
          <div
            key={fmt.id}
            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
              isLocked ? 'border-slate-700 opacity-60' : 'border-slate-600 hover:border-violet-600 hover:bg-violet-950/20'
            }`}
          >
            <fmt.Icon className="h-5 w-5 text-slate-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{fmt.label}</span>
                {fmt.tier === 'pro' && (
                  <Badge className="text-[10px] bg-violet-900 text-violet-300 py-0">Pro</Badge>
                )}
                {fmt.tier === 'free' && (
                  <Badge variant="outline" className="text-[10px] border-green-700 text-green-400 py-0">Free</Badge>
                )}
              </div>
              <p className="text-xs text-slate-400">{fmt.description}</p>
            </div>
            <Button
              size="sm"
              disabled={isLocked || isExportingThis || !!exporting}
              onClick={() => handleExport(fmt.id)}
              className={isLocked ? 'bg-slate-700 cursor-not-allowed' : 'bg-violet-600 hover:bg-violet-700'}
            >
              {isLocked ? (
                <Lock className="h-3.5 w-3.5" />
              ) : isExportingThis ? (
                <span className="text-xs">...</span>
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        );
      })}

      {exporting && (
        <div className="space-y-1.5 mt-2">
          <div className="flex justify-between text-xs text-slate-400">
            <span>Rendering {exporting}...</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
      )}

      <EmbedCode assetId={asset.id} />
    </div>
  );
}
