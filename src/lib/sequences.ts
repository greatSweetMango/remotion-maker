import type { Parameter } from '@/types';

export interface SequenceSegment {
  /** Stable id derived from the Sequence `name` prop (kebab-case). */
  id: string;
  /** Human-readable label (Title Case). */
  label: string;
  /** Frame at which the sequence begins. */
  from: number;
  /** Length in frames. */
  durationInFrames: number;
}

export const GLOBAL_SEQUENCE_ID = 'global' as const;
export const ALL_MODE_ID = 'all' as const;

/**
 * Parse `<Sequence from={N} durationInFrames={N} name="...">` calls from the
 * raw template source. We rely on the canonical TM-27 emission pattern; props
 * may appear in any order. We do NOT execute the code — pure regex over the
 * source string keeps this side-effect-free and works pre-evaluator.
 */
export function extractSequences(source: string): SequenceSegment[] {
  const out: SequenceSegment[] = [];
  // Match <Sequence ...> opening tags (self-closing or with children).
  const tagRe = /<Sequence\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  const seenIds = new Set<string>();

  while ((m = tagRe.exec(source)) !== null) {
    const attrs = m[1];
    const fromMatch = attrs.match(/from=\{(-?\d+)\}/);
    const durMatch = attrs.match(/durationInFrames=\{(-?\d+)\}/);
    const nameMatch = attrs.match(/name=(?:"([^"]+)"|'([^']+)'|\{['"]([^'"]+)['"]\})/);
    if (!fromMatch || !durMatch) continue;

    const from = parseInt(fromMatch[1], 10);
    const durationInFrames = parseInt(durMatch[1], 10);
    const rawName = nameMatch?.[1] ?? nameMatch?.[2] ?? nameMatch?.[3] ?? `seq-${out.length + 1}`;
    const id = toSequenceId(rawName);
    // Skip duplicate ids (could happen if user re-uses names) — keep first.
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    out.push({
      id,
      label: toLabel(rawName),
      from,
      durationInFrames,
    });
  }
  // Sort by start frame for deterministic ordering.
  out.sort((a, b) => a.from - b.from);
  return out;
}

function toSequenceId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toLabel(name: string): string {
  return name
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Determine which sequence is active at a given frame.
 * Returns the sequence whose [from, from+duration) interval contains the frame.
 * Falls back to the last sequence if frame >= total duration, first otherwise.
 */
export function activeSequenceAt(
  segments: SequenceSegment[],
  frame: number,
): SequenceSegment | null {
  if (segments.length === 0) return null;
  for (const seg of segments) {
    if (frame >= seg.from && frame < seg.from + seg.durationInFrames) return seg;
  }
  // Frame past the last sequence — clamp to last.
  const last = segments[segments.length - 1];
  if (frame >= last.from) return last;
  return segments[0];
}

/**
 * Heuristic: which sequence does a parameter belong to when no explicit
 * `sequence:` annotation is present? Rules (in order):
 *   1. Color group → 'global' (always shown).
 *   2. Key starts with a sequence id (after camel→kebab): match.
 *      e.g. `feature1Title` → kebab `feature-1-title` → starts with `feature-1`.
 *   3. Key contains `intro` / `outro` substring → match those segments.
 *   4. Otherwise → 'global'.
 */
export function inferParamSequences(
  param: Parameter,
  segments: SequenceSegment[],
): string[] {
  if (param.group === 'color') return [GLOBAL_SEQUENCE_ID];

  const kebab = param.key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
  // Insert hyphen before trailing digits attached to letters: feature1 → feature-1
  const normalized = kebab.replace(/([a-z])(\d)/g, '$1-$2');

  const matched: string[] = [];
  for (const seg of segments) {
    if (normalized.startsWith(seg.id + '-') || normalized === seg.id) {
      matched.push(seg.id);
    }
  }
  if (matched.length > 0) return matched;

  const lower = param.key.toLowerCase();
  for (const seg of segments) {
    if (seg.id === 'intro' && lower.includes('intro')) matched.push(seg.id);
    if (seg.id === 'outro' && lower.includes('outro')) matched.push(seg.id);
  }
  if (matched.length > 0) return matched;

  return [GLOBAL_SEQUENCE_ID];
}

/**
 * Filter parameters for a given sequence id.
 *  - `ALL_MODE_ID` returns every parameter (no filtering).
 *  - Otherwise returns params whose sequenceIds contains the active id OR `'global'`.
 */
export function filterParamsForSequence(
  parameters: Parameter[],
  segments: SequenceSegment[],
  activeId: string,
): Parameter[] {
  if (activeId === ALL_MODE_ID || segments.length === 0) return parameters;

  return parameters.filter(p => {
    const ids = (p.sequenceIds && p.sequenceIds.length > 0)
      ? p.sequenceIds
      : inferParamSequences(p, segments);
    return ids.includes(GLOBAL_SEQUENCE_ID) || ids.includes(activeId);
  });
}
