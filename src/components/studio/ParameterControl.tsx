'use client';
import React, { useMemo, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { searchLucideCatalog, DEFAULT_LUCIDE_ICON } from '@/lib/lucide-catalog';
import type { Parameter } from '@/types';

type LucideIconComponent = React.ComponentType<{ size?: number | string; className?: string }>;
type LucideMap = Record<string, LucideIconComponent>;
const LucideMap = LucideIcons as unknown as LucideMap;

function resolveLucideIcon(name: string): LucideIconComponent {
  return LucideMap[name] ?? LucideMap[DEFAULT_LUCIDE_ICON] ?? LucideIcons.Star;
}

interface ParameterControlProps {
  param: Parameter;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
  locked?: boolean;
}

export function ParameterControl({ param, value, onChange, locked }: ParameterControlProps) {
  if (locked) {
    return (
      <div className="opacity-50 pointer-events-none relative">
        <ControlContent param={param} value={value} onChange={onChange} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs bg-violet-900/90 text-violet-200 px-2 py-0.5 rounded-full">Pro</span>
        </div>
      </div>
    );
  }

  return <ControlContent param={param} value={value} onChange={onChange} />;
}

function ControlContent({ param, value, onChange }: Omit<ParameterControlProps, 'locked'>) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-400 font-medium">{param.label}</Label>

      {param.type === 'color' && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-2 w-full px-3 py-2 rounded-md border border-slate-600 bg-slate-800 hover:bg-slate-700 transition-colors">
              <div
                className="w-5 h-5 rounded-sm border border-slate-500 flex-shrink-0"
                style={{ backgroundColor: value as string }}
              />
              <span className="text-sm text-slate-300 font-mono">{value as string}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3 bg-slate-800 border-slate-600" side="left">
            <HexColorPicker color={value as string} onChange={onChange} />
            <Input
              value={value as string}
              onChange={e => onChange(e.target.value)}
              className="mt-2 bg-slate-700 border-slate-600 text-white font-mono text-xs"
              placeholder="#000000"
            />
          </PopoverContent>
        </Popover>
      )}

      {param.type === 'range' && (
        <div className="flex items-center gap-3">
          <Slider
            min={param.min ?? 0}
            max={param.max ?? 100}
            step={param.step ?? 0.1}
            value={[value as number]}
            onValueChange={([v]) => onChange(v)}
            className="flex-1"
          />
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={value as number}
              min={param.min}
              max={param.max}
              step={param.step ?? 0.1}
              onChange={e => onChange(parseFloat(e.target.value) || 0)}
              className="w-20 bg-slate-700 border-slate-600 text-white text-xs text-center"
            />
            {param.unit && <span className="text-xs text-slate-500">{param.unit}</span>}
          </div>
        </div>
      )}

      {param.type === 'text' && (
        <Input
          value={value as string}
          onChange={e => onChange(e.target.value)}
          className="bg-slate-700 border-slate-600 text-white"
        />
      )}

      {param.type === 'boolean' && (
        <div className="flex items-center gap-2">
          <Switch
            checked={value as boolean}
            onCheckedChange={onChange}
          />
          <span className="text-sm text-slate-400">{value ? 'On' : 'Off'}</span>
        </div>
      )}

      {param.type === 'icon' && (
        <IconPickerControl value={(value as string) || DEFAULT_LUCIDE_ICON} onChange={onChange} />
      )}

      {param.type === 'select' && (
        <Select value={value as string} onValueChange={onChange}>
          <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-600">
            {param.options?.map(opt => (
              <SelectItem key={opt} value={opt} className="text-white hover:bg-slate-700">
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

interface IconPickerControlProps {
  value: string;
  onChange: (value: string) => void;
}

interface LucideIconRenderProps {
  name: string;
  size?: number;
  className?: string;
}

function LucideIconRender({ name, size = 18, className }: LucideIconRenderProps) {
  return React.createElement(resolveLucideIcon(name), { size, className });
}

function IconPickerControl({ value, onChange }: IconPickerControlProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => searchLucideCatalog(query), [query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 w-full px-3 py-2 rounded-md border border-slate-600 bg-slate-800 hover:bg-slate-700 transition-colors"
        >
          <LucideIconRender name={value} size={18} className="text-slate-200 flex-shrink-0" />
          <span className="text-sm text-slate-300 font-mono truncate">{value}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-3 bg-slate-800 border-slate-600"
        side="left"
        align="start"
      >
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search icons…"
          className="bg-slate-700 border-slate-600 text-white text-xs mb-2"
        />
        <div className="grid grid-cols-6 gap-1 max-h-56 overflow-y-auto">
          {results.map(entry => {
            const active = entry.name === value;
            return (
              <button
                key={entry.name}
                type="button"
                title={entry.name}
                onClick={() => {
                  onChange(entry.name);
                  setOpen(false);
                }}
                className={
                  'flex items-center justify-center aspect-square rounded-md border transition-colors ' +
                  (active
                    ? 'border-violet-500 bg-violet-900/40 text-violet-200'
                    : 'border-slate-700 bg-slate-700/40 text-slate-300 hover:bg-slate-700')
                }
              >
                <LucideIconRender name={entry.name} size={18} />
              </button>
            );
          })}
          {results.length === 0 && (
            <div className="col-span-6 text-center text-xs text-slate-500 py-4">
              No icons match &quot;{query}&quot;
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
