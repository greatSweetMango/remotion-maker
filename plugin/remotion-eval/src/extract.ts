/**
 * extract_params — pure Node port of src/lib/ai/extract-params.ts.
 *
 * Scans LLM-generated Remotion code for `const PARAMS = { ... }` declarations
 * and returns a normalized `Parameter[]` shape used by the customize UI
 * (ADR-0002 PARAMS auto-extract). No DOM / React deps — safe to run inside
 * the MCP stdio server.
 *
 * Output schema is intentionally identical to the in-app implementation so
 * callers (agents, Orchestrator) can rely on a stable contract:
 *
 *   { key, label, group, type, value, min?, max?, unit?, options?,
 *     sequenceIds?, regenPrompt? }
 *
 * Keep this file dependency-free — the only contract with the rest of the
 * codebase is the regex grammar of the `// type: …` annotations.
 */

export type ParameterType =
  | 'color'
  | 'range'
  | 'text'
  | 'boolean'
  | 'select'
  | 'icon'
  | 'image'
  | 'font';

export type ParameterGroup =
  | 'color'
  | 'size'
  | 'timing'
  | 'text'
  | 'media'
  | 'other';

export interface Parameter {
  key: string;
  label: string;
  group: ParameterGroup;
  type: ParameterType;
  value: string | number | boolean;
  min?: number;
  max?: number;
  unit?: string;
  options?: string[];
  sequenceIds?: string[];
  regenPrompt?: string;
}

export interface ExtractResult {
  ok: boolean;
  errors: string[];
  parameters: Parameter[];
  paramsCount: number;
}

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
    const type = typeStr as ParameterType;

    const parseNum = (s: string) => parseFloat(s.trim());
    const minMatch = rest.match(/min:\s*([\d.]+)/);
    const maxMatch = rest.match(/max:\s*([\d.]+)/);
    const unitMatch = rest.match(/unit:\s*(\w+)/);
    const optionsMatch = rest.match(/options:\s*([\w|]+)/);
    const sequenceMatch = rest.match(/sequence(?:Ids?)?:\s*([a-z0-9|_-]+)/i);
    const sequenceIds = sequenceMatch
      ? sequenceMatch[1].split('|').map((s) => s.trim()).filter(Boolean)
      : undefined;

    // TM-88 / ADR-0022 — `regen_prompt:` annotation for type:image params.
    const regenPromptMatch = rest.match(
      /regen_prompt:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/,
    );
    const regenPrompt = regenPromptMatch
      ? (regenPromptMatch[1] ?? regenPromptMatch[2] ?? regenPromptMatch[3])
      : undefined;

    const label = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (s) => s.toUpperCase())
      .trim();

    let group: ParameterGroup = 'other';
    if (type === 'color') group = 'color';
    else if (type === 'image' || type === 'font') group = 'media';
    else if (
      key.toLowerCase().includes('speed') ||
      key.toLowerCase().includes('duration') ||
      key.toLowerCase().includes('delay')
    )
      group = 'timing';
    else if (
      key.toLowerCase().includes('size') ||
      key.toLowerCase().includes('font') ||
      key.toLowerCase().includes('width') ||
      key.toLowerCase().includes('height') ||
      key.toLowerCase().includes('radius')
    )
      group = 'size';
    else if (type === 'text') group = 'text';

    const value: string | number | boolean =
      type === 'color'
        ? rawValue.replace(/['"]/g, '').trim()
        : type === 'boolean'
          ? rawValue.trim() === 'true'
          : type === 'text' ||
              type === 'select' ||
              type === 'icon' ||
              type === 'image' ||
              type === 'font'
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

/**
 * MCP tool wrapper — returns a stable {ok, errors, parameters, paramsCount}
 * envelope so callers can branch on `ok` without try/catch.
 */
export function extractParamsTool(code: unknown): ExtractResult {
  if (typeof code !== 'string' || code.trim().length === 0) {
    return {
      ok: false,
      errors: ['invalid-input: code must be a non-empty string'],
      parameters: [],
      paramsCount: 0,
    };
  }
  const parameters = extractParameters(code);
  return {
    ok: true,
    errors: [],
    parameters,
    paramsCount: parameters.length,
  };
}
