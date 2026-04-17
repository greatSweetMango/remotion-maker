'use client';
import React from 'react';
import { HexColorPicker } from 'react-colorful';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Parameter } from '@/types';

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
