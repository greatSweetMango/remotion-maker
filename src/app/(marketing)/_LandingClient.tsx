'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { TemplateCard } from '@/components/gallery/TemplateCard';
import { FilterBar, type Category } from '@/components/gallery/FilterBar';
import { Zap, Sliders, Code2, Download, ArrowRight } from 'lucide-react';
import type { Template } from '@/types';

interface LandingClientProps {
  templates: Template[];
}

const FEATURES = [
  {
    Icon: Zap,
    title: 'AI Generation',
    description: 'Describe your animation in plain text. Claude generates production-ready Remotion code instantly.',
  },
  {
    Icon: Sliders,
    title: 'Dynamic Customization',
    description: 'Auto-generated sliders, color pickers, and inputs let you tweak every parameter in real time.',
  },
  {
    Icon: Code2,
    title: 'React Component Export',
    description: 'Download as a .tsx file and drop directly into your React project.',
  },
  {
    Icon: Download,
    title: 'Multiple Formats',
    description: 'Export GIF, MP4, WebM with alpha channel, or PNG sequences.',
  },
];

export default function LandingClient({ templates }: LandingClientProps) {
  const [activeCategory, setActiveCategory] = useState<Category>('all');

  const filtered = activeCategory === 'all'
    ? templates
    : templates.filter(t => t.category === activeCategory);

  return (
    <div className="pt-20">
      <section className="px-6 py-24 text-center max-w-5xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-violet-950/50 border border-violet-700/50 rounded-full px-4 py-1.5 text-sm text-violet-300 mb-8">
          <Zap className="h-3.5 w-3.5" />
          AI-powered motion asset generator
        </div>

        <h1 className="text-5xl md:text-7xl font-black text-white leading-[1.05] tracking-tight mb-6">
          Animate anything,
          <br />
          <span className="bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent">
            your way
          </span>
        </h1>

        <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Type a prompt. Get a Remotion animation. Customize with auto-generated controls.
          Export as GIF, MP4, WebM, or React component.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button asChild size="lg" className="bg-violet-600 hover:bg-violet-700 text-base h-12 px-8">
            <Link href="/login">
              Start for Free
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-slate-600 text-white hover:bg-slate-800 text-base h-12 px-8">
            <Link href="#gallery">Browse Templates</Link>
          </Button>
        </div>

        <div className="flex flex-wrap justify-center gap-8 mt-16 text-center">
          {[
            { value: '3', label: 'Free generations / month' },
            { value: '<10s', label: 'Generation time' },
            { value: '0', label: 'Render cost to preview' },
          ].map(({ value, label }) => (
            <div key={label}>
              <div className="text-3xl font-bold text-white">{value}</div>
              <div className="text-sm text-slate-400 mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 py-20 bg-slate-900/50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-12">
            The loop that works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {FEATURES.map(({ Icon, title, description }) => (
              <div key={title} className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
                <div className="w-10 h-10 rounded-lg bg-violet-900/50 flex items-center justify-center mb-4">
                  <Icon className="h-5 w-5 text-violet-400" />
                </div>
                <h3 className="text-white font-semibold mb-2">{title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="gallery" className="px-6 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
            <div>
              <h2 className="text-3xl font-bold text-white">Template Gallery</h2>
              <p className="text-slate-400 mt-2">Click to open in Studio and customize</p>
            </div>
            <FilterBar active={activeCategory} onChange={setActiveCategory} />
          </div>

          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map(template => (
                <TemplateCard key={template.id} template={template} />
              ))}
            </div>
          ) : (
            <div className="text-center py-20 text-slate-500">
              No templates in this category yet
            </div>
          )}
        </div>
      </section>

      <section className="px-6 py-20 text-center bg-gradient-to-b from-slate-900/0 to-violet-950/20">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to animate?</h2>
          <p className="text-slate-400 mb-8">3 free generations per month. No credit card required.</p>
          <Button asChild size="lg" className="bg-violet-600 hover:bg-violet-700 text-base h-12 px-8">
            <Link href="/login">
              Get Started Free
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-slate-800 px-6 py-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-violet-400" />
            <span className="text-white font-semibold text-sm">EasyMake</span>
          </div>
          <p className="text-slate-500 text-sm">Animate anything, your way</p>
          <div className="flex gap-4 text-sm text-slate-500">
            <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
