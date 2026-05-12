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
    // Sequence membership annotation: `sequence: intro|feature-1|global` (kebab-case ids)
    const sequenceMatch = rest.match(/sequence(?:Ids?)?:\s*([a-z0-9|_-]+)/i);
    const sequenceIds = sequenceMatch
      ? sequenceMatch[1].split('|').map(s => s.trim()).filter(Boolean)
      : undefined;

    // TM-88 / ADR-0022 — `regen_prompt:` annotation for type:image params.
    // The LLM (asset-gen stage) emits the original prompt it used to generate
    // the image; the customize UI surfaces a "Regenerate" button that lets the
    // user edit this prompt and call /api/asset/regen-image to get a fresh
    // imageUrl. The prompt string may contain spaces, commas, etc., but MUST
    // be wrapped in a quoted string to avoid colliding with the comma-separated
    // annotation grammar — we accept either '...', "..." or `...`.
    // Example: `imageUrl: "..." // type: image, regen_prompt: "곰돌이 캐릭터, 친근한"`
    const regenPromptMatch = rest.match(/regen_prompt:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/);
    const regenPrompt = regenPromptMatch
      ? (regenPromptMatch[1] ?? regenPromptMatch[2] ?? regenPromptMatch[3])
      : undefined;

    const label = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .trim();

    let group: Parameter['group'] = 'other';
    if (type === 'color') group = 'color';
    else if (type === 'image' || type === 'font') group = 'media';
    else if (key.toLowerCase().includes('speed') || key.toLowerCase().includes('duration') || key.toLowerCase().includes('delay')) group = 'timing';
    else if (key.toLowerCase().includes('size') || key.toLowerCase().includes('font') || key.toLowerCase().includes('width') || key.toLowerCase().includes('height') || key.toLowerCase().includes('radius')) group = 'size';
    else if (type === 'text') group = 'text';

    const value: string | number | boolean = type === 'color'
      ? rawValue.replace(/['"]/g, '').trim()
      : type === 'boolean'
        ? rawValue.trim() === 'true'
        : type === 'text' || type === 'select' || type === 'icon' || type === 'image' || type === 'font'
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
      sequenceIds,
      regenPrompt,
    });
  }

  return params;
}
