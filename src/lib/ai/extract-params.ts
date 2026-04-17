import type { Parameter } from '@/types';

export function extractParameters(code: string): Parameter[] {
  const params: Parameter[] = [];

  const paramsMatch = code.match(/const PARAMS\s*=\s*\{([\s\S]*?)\}\s*(?:as const)?/);
  if (!paramsMatch) return params;

  const paramsBody = paramsMatch[1];
  const lines = paramsBody.split('\n');

  for (const line of lines) {
    const match = line.match(/^\s*(\w+)\s*:\s*(.+?),?\s*\/\/\s*type:\s*(\w+)(.*?)$/);
    if (!match) continue;

    const [, key, rawValue, typeStr, rest] = match;
    const type = typeStr as Parameter['type'];

    const parseNum = (s: string) => parseFloat(s.trim());
    const minMatch = rest.match(/min:\s*([\d.]+)/);
    const maxMatch = rest.match(/max:\s*([\d.]+)/);
    const unitMatch = rest.match(/unit:\s*(\w+)/);
    const optionsMatch = rest.match(/options:\s*([\w|]+)/);

    const label = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .trim();

    let group: Parameter['group'] = 'other';
    if (type === 'color') group = 'color';
    else if (key.toLowerCase().includes('speed') || key.toLowerCase().includes('duration') || key.toLowerCase().includes('delay')) group = 'timing';
    else if (key.toLowerCase().includes('size') || key.toLowerCase().includes('font') || key.toLowerCase().includes('width') || key.toLowerCase().includes('height') || key.toLowerCase().includes('radius')) group = 'size';
    else if (type === 'text') group = 'text';

    const value: string | number | boolean = type === 'color'
      ? rawValue.replace(/['"]/g, '').trim()
      : type === 'boolean'
        ? rawValue.trim() === 'true'
        : type === 'text' || type === 'select'
          ? rawValue.replace(/['"]/g, '').trim()
          : parseFloat(rawValue) || 0;

    params.push({
      key,
      label,
      group,
      type,
      value,
      min: minMatch ? parseNum(minMatch[1]) : undefined,
      max: maxMatch ? parseNum(maxMatch[1]) : undefined,
      unit: unitMatch?.[1],
      options: optionsMatch ? optionsMatch[1].split('|') : undefined,
    });
  }

  return params;
}
