import { transpileTSX } from '@/lib/remotion/transpiler';
import { sanitizeCode } from '@/lib/remotion/sandbox';
import type { Template, Parameter } from '@/types';
import fs from 'fs';
import path from 'path';

async function loadTemplate(
  filename: string,
  meta: Omit<Template, 'code' | 'jsCode' | 'parameters'>
): Promise<Template> {
  const filePath = path.join(process.cwd(), 'src/remotion/templates', filename);
  const code = fs.readFileSync(filePath, 'utf-8');

  const sanitized = sanitizeCode(code);
  const jsCode = await transpileTSX(sanitized);

  const paramsMatch = code.match(/const PARAMS\s*=\s*\{([\s\S]*?)\}\s*as const/);
  const parameters: Parameter[] = [];

  if (paramsMatch) {
    const lines = paramsMatch[1].split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*(\w+)\s*:\s*(.+?),?\s*\/\/\s*type:\s*(\w+)(.*?)$/);
      if (!match) continue;
      const [, key, rawValue, typeStr, rest] = match;

      const minMatch = rest.match(/min:\s*([\d.]+)/);
      const maxMatch = rest.match(/max:\s*([\d.]+)/);
      const unitMatch = rest.match(/unit:\s*(\w+)/);
      const optionsMatch = rest.match(/options:\s*([\w|]+)/);
      const type = typeStr as Parameter['type'];

      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
      let group: Parameter['group'] = 'other';
      if (type === 'color') group = 'color';
      else if (key.toLowerCase().includes('size') || key.toLowerCase().includes('font') || key.toLowerCase().includes('stroke') || key.toLowerCase().includes('width') || key.toLowerCase().includes('height') || key.toLowerCase().includes('gap') || key.toLowerCase().includes('bar') || key.toLowerCase().includes('blur')) group = 'size';
      else if (key.toLowerCase().includes('speed') || key.toLowerCase().includes('duration') || key.toLowerCase().includes('stagger')) group = 'timing';
      else if (type === 'text') group = 'text';

      const cleanValue = rawValue.trim().replace(/,$/, '');
      const value: string | number | boolean =
        type === 'color' ? cleanValue.replace(/['"]/g, '')
        : type === 'boolean' ? cleanValue === 'true'
        : type === 'text' ? cleanValue.replace(/['"]/g, '')
        : parseFloat(cleanValue) || 0;

      parameters.push({
        key, label, group, type, value,
        min: minMatch ? parseFloat(minMatch[1]) : undefined,
        max: maxMatch ? parseFloat(maxMatch[1]) : undefined,
        unit: unitMatch?.[1],
        options: optionsMatch ? optionsMatch[1].split('|') : undefined,
      });
    }
  }

  return { ...meta, code, jsCode, parameters };
}

let _templates: Template[] | null = null;

export async function getTemplates(): Promise<Template[]> {
  if (_templates) return _templates;

  _templates = await Promise.all([
    loadTemplate('CounterAnimation.tsx', {
      id: 'counter-animation',
      title: 'Counter Animation',
      description: 'Spring-physics number counter with progress bar',
      category: 'counter',
      durationInFrames: 150,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('ProgressCircle.tsx', {
      id: 'progress-circle',
      title: 'Progress Circle',
      description: 'Animated SVG circular progress indicator',
      category: 'counter',
      durationInFrames: 120,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('ComicEffect.tsx', {
      id: 'comic-effect',
      title: 'Comic Effect',
      description: 'Explosive comic book sound effect',
      category: 'text',
      durationInFrames: 90,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('TextReveal.tsx', {
      id: 'text-reveal',
      title: 'Text Reveal',
      description: 'Letters drop in one by one with spring stagger',
      category: 'text',
      durationInFrames: 120,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('Typewriter.tsx', {
      id: 'typewriter',
      title: 'Typewriter',
      description: 'Classic typewriter text reveal with blinking cursor',
      category: 'text',
      durationInFrames: 150,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('SplitText.tsx', {
      id: 'split-text',
      title: 'Split Text',
      description: 'Bold words slide in from opposite directions',
      category: 'text',
      durationInFrames: 90,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('BarChart.tsx', {
      id: 'bar-chart',
      title: 'Bar Chart',
      description: 'Animated bar chart with spring animation',
      category: 'chart',
      durationInFrames: 150,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('GradientOrbs.tsx', {
      id: 'gradient-orbs',
      title: 'Gradient Orbs',
      description: 'Flowing color orbs abstract background',
      category: 'background',
      durationInFrames: 180,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('CirclePulse.tsx', {
      id: 'circle-pulse',
      title: 'Circle Pulse',
      description: 'Rippling pulse circles — perfect for live badges',
      category: 'background',
      durationInFrames: 120,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('LowerThird.tsx', {
      id: 'lower-third',
      title: 'Lower Third',
      description: 'Social media name card with slide-in animation',
      category: 'logo',
      durationInFrames: 120,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('ProductIntro.tsx', {
      id: 'product-intro',
      title: 'Product Intro (60s)',
      description: 'Full 60s product showcase: intro → 3 features → CTA. Add voice-over and ship to YouTube.',
      category: 'composition',
      durationInFrames: 1800,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('DataStory.tsx', {
      id: 'data-story',
      title: 'Data Story (45s)',
      description: 'Hero stat reveals with insight callouts — perfect for year-in-review or KPI narratives.',
      category: 'composition',
      durationInFrames: 1350,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('HighlightReel.tsx', {
      id: 'highlight-reel',
      title: 'Highlight Reel (30s)',
      description: 'Punchy 30s recap with three numbered highlights. Drop in voice and post.',
      category: 'composition',
      durationInFrames: 900,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('LineChart.tsx', {
      id: 'line-chart',
      title: 'Line Chart',
      description: 'Animated line chart with gradient fill and data dots',
      category: 'chart',
      durationInFrames: 150,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('DonutChart.tsx', {
      id: 'donut-chart',
      title: 'Donut Chart',
      description: 'Sweeping donut chart with legend and percentages',
      category: 'chart',
      durationInFrames: 150,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('AreaChart.tsx', {
      id: 'area-chart',
      title: 'Area Chart',
      description: 'Wipe-revealed area chart with subtle gridlines',
      category: 'chart',
      durationInFrames: 150,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('ProgressBar.tsx', {
      id: 'progress-bar',
      title: 'Progress Bars',
      description: 'Stacked horizontal progress bars with staggered fill',
      category: 'chart',
      durationInFrames: 150,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('GlowingText.tsx', {
      id: 'glowing-text',
      title: 'Glowing Text',
      description: 'Neon-pulsing headline with dual-color glow',
      category: 'text',
      durationInFrames: 150,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('WaveText.tsx', {
      id: 'wave-text',
      title: 'Wave Text',
      description: 'Per-character sinusoidal wave with color gradient',
      category: 'text',
      durationInFrames: 180,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('RotatingText.tsx', {
      id: 'rotating-text',
      title: 'Rotating Text',
      description: 'Word swap animation — perfect for hero rotators',
      category: 'text',
      durationInFrames: 240,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('LogoReveal.tsx', {
      id: 'logo-reveal',
      title: 'Logo Reveal',
      description: 'Ring stroke + brand fade — clean intro for any video',
      category: 'transition',
      durationInFrames: 90,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('ZoomTransition.tsx', {
      id: 'zoom-transition',
      title: 'Zoom Transition',
      description: 'Punch-in/punch-out scene change with white flash',
      category: 'transition',
      durationInFrames: 90,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('ParticleField.tsx', {
      id: 'particle-field',
      title: 'Particle Field',
      description: 'Drifting glow particles — atmospheric loopable background',
      category: 'background',
      durationInFrames: 240,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('Timeline.tsx', {
      id: 'timeline',
      title: 'Timeline',
      description: 'Horizontal milestone timeline with staggered dots',
      category: 'infographic',
      durationInFrames: 180,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('IconBadge.tsx', {
      id: 'icon-badge',
      title: 'Icon Badge',
      description: 'Spinning conic-gradient badge with title + subtitle',
      category: 'infographic',
      durationInFrames: 120,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('ParticlePhysics.tsx', {
      id: 'particle-physics',
      title: 'Particle Physics',
      description: 'Gravity-driven particle burst with bounce + tri-color gradient',
      category: 'background',
      durationInFrames: 480,
      fps: 60,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('MorphingGeometry.tsx', {
      id: 'morphing-geometry',
      title: 'Morphing Geometry',
      description: 'Cube → sphere → torus 3D morph with gradient stroke',
      category: 'background',
      durationInFrames: 480,
      fps: 60,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('TypeExplosion.tsx', {
      id: 'type-explosion',
      title: 'Type Explosion',
      description: 'Per-character spring explosion → reassembly headline',
      category: 'text',
      durationInFrames: 360,
      fps: 60,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('FlowField.tsx', {
      id: 'flow-field',
      title: 'Flow Field',
      description: 'Perlin-style vector field with traced particle trails',
      category: 'background',
      durationInFrames: 480,
      fps: 60,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('FluidBlobs.tsx', {
      id: 'fluid-blobs',
      title: 'Fluid Blobs',
      description: 'Metaball goo effect via SVG feGaussianBlur + feColorMatrix',
      category: 'background',
      durationInFrames: 480,
      fps: 60,
      width: 1920,
      height: 1080,
    }),
  ]);

  return _templates;
}
