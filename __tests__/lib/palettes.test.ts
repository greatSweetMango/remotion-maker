import {
  PALETTES,
  mapColorKeyToSlot,
  buildPaletteUpdates,
} from '@/lib/palettes';
import type { Parameter } from '@/types';

describe('mapColorKeyToSlot', () => {
  it('maps primary-family keys to primary', () => {
    expect(mapColorKeyToSlot('primaryColor')).toBe('primary');
    expect(mapColorKeyToSlot('mainColor')).toBe('primary');
  });

  it('maps secondary keys to secondary', () => {
    expect(mapColorKeyToSlot('secondaryColor')).toBe('secondary');
  });

  it('maps accent / highlight keys to accent', () => {
    expect(mapColorKeyToSlot('accentColor')).toBe('accent');
    expect(mapColorKeyToSlot('highlightColor')).toBe('accent');
  });

  it('maps background-family keys to background (before color match)', () => {
    expect(mapColorKeyToSlot('backgroundColor')).toBe('background');
    expect(mapColorKeyToSlot('bg')).toBe('background');
  });

  it('maps text/label/foreground to text', () => {
    expect(mapColorKeyToSlot('textColor')).toBe('text');
    expect(mapColorKeyToSlot('labelColor')).toBe('text');
    expect(mapColorKeyToSlot('fg')).toBe('text');
  });

  it('returns null for ambiguous / numbered / specialized keys', () => {
    expect(mapColorKeyToSlot('color1')).toBeNull();
    expect(mapColorKeyToSlot('color2')).toBeNull();
    expect(mapColorKeyToSlot('strokeColor')).toBeNull();
    expect(mapColorKeyToSlot('cursorColor')).toBeNull();
    expect(mapColorKeyToSlot('trackColor')).toBeNull();
  });
});

describe('buildPaletteUpdates', () => {
  const palette = PALETTES[0]; // Vivid

  const mkColor = (key: string): Parameter => ({
    key,
    label: key,
    group: 'color',
    type: 'color',
    value: '#000000',
  });

  it('applies palette to all color keys via heuristic match', () => {
    const params: Parameter[] = [
      mkColor('primaryColor'),
      mkColor('secondaryColor'),
      mkColor('accentColor'),
      mkColor('backgroundColor'),
      mkColor('textColor'),
    ];

    const updates = buildPaletteUpdates(params, palette);

    expect(updates).toEqual({
      primaryColor: palette.colors.primary,
      secondaryColor: palette.colors.secondary,
      accentColor: palette.colors.accent,
      backgroundColor: palette.colors.background,
      textColor: palette.colors.text,
    });
  });

  it('cycles through slots for unknown keys so every color is updated', () => {
    const params: Parameter[] = [
      mkColor('color1'),
      mkColor('color2'),
      mkColor('color3'),
      mkColor('strokeColor'),
    ];

    const updates = buildPaletteUpdates(params, palette);

    // All four keys must have a value from the palette.
    expect(Object.keys(updates)).toHaveLength(4);
    expect(updates.color1).toBe(palette.colors.primary);
    expect(updates.color2).toBe(palette.colors.secondary);
    expect(updates.color3).toBe(palette.colors.accent);
    expect(updates.strokeColor).toBe(palette.colors.background);
  });

  it('mixes matched + unmatched without collision', () => {
    const params: Parameter[] = [
      mkColor('backgroundColor'), // matched -> background
      mkColor('color1'),          // unmatched -> cycles primary
      mkColor('textColor'),       // matched -> text
      mkColor('color2'),          // unmatched -> cycles secondary
    ];

    const updates = buildPaletteUpdates(params, palette);

    expect(updates.backgroundColor).toBe(palette.colors.background);
    expect(updates.textColor).toBe(palette.colors.text);
    expect(updates.color1).toBe(palette.colors.primary);
    expect(updates.color2).toBe(palette.colors.secondary);
  });

  it('ignores non-color parameters', () => {
    const params: Parameter[] = [
      mkColor('primaryColor'),
      { key: 'fontSize', label: 'Font Size', group: 'size', type: 'range', value: 80 },
      { key: 'speed', label: 'Speed', group: 'timing', type: 'range', value: 1 },
      { key: 'message', label: 'Message', group: 'text', type: 'text', value: 'hi' },
    ];

    const updates = buildPaletteUpdates(params, palette);

    expect(Object.keys(updates)).toEqual(['primaryColor']);
    expect(updates.primaryColor).toBe(palette.colors.primary);
  });

  it('returns empty object when there are no color params', () => {
    const params: Parameter[] = [
      { key: 'fontSize', label: 'Font Size', group: 'size', type: 'range', value: 80 },
    ];
    expect(buildPaletteUpdates(params, palette)).toEqual({});
  });
});

describe('PALETTES catalog', () => {
  it('exports at least 5 palettes', () => {
    expect(PALETTES.length).toBeGreaterThanOrEqual(5);
  });

  it('every palette defines all five slots with non-empty hex values', () => {
    for (const p of PALETTES) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      for (const slot of ['primary', 'secondary', 'accent', 'background', 'text'] as const) {
        expect(p.colors[slot]).toMatch(/^#[0-9A-Fa-f]{3,8}$/);
      }
    }
  });

  it('palette ids are unique', () => {
    const ids = PALETTES.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
