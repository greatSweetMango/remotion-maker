import { transpileTSX } from '@/lib/remotion/transpiler';
import { sanitizeCode } from '@/lib/remotion/sandbox';
import type { Template, Parameter } from '@/types';
import fs from 'fs';
import path from 'path';

async function loadTemplate(filename: string, meta: Omit<Template, 'code' | 'jsCode' | 'parameters'>): Promise<Template> {
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
      else if (key.toLowerCase().includes('size') || key.toLowerCase().includes('font')) group = 'size';
      else if (key.toLowerCase().includes('speed') || key.toLowerCase().includes('duration')) group = 'timing';
      else if (type === 'text') group = 'text';

      const cleanValue = rawValue.trim().replace(/,$/, '');
      const value: string | number | boolean = type === 'color' ? cleanValue.replace(/['"]/g, '')
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
      description: 'Animated number counter with spring physics',
      category: 'counter',
      durationInFrames: 150,
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
  ]);

  return _templates;
}
