'use client';
import React from 'react';

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'counter', label: 'Counter' },
  { id: 'text', label: 'Text FX' },
  { id: 'chart', label: 'Charts' },
  { id: 'background', label: 'Background' },
  { id: 'logo', label: 'Logo' },
  { id: 'transition', label: 'Transitions' },
  { id: 'infographic', label: 'Infographics' },
  { id: 'composition', label: 'Compositions' },
] as const;

export type Category = typeof CATEGORIES[number]['id'];

interface FilterBarProps {
  active: Category;
  onChange: (cat: Category) => void;
}

export function FilterBar({ active, onChange }: FilterBarProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      {CATEGORIES.map(cat => (
        <button
          key={cat.id}
          onClick={() => onChange(cat.id)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            active === cat.id
              ? 'bg-violet-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
          }`}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}
