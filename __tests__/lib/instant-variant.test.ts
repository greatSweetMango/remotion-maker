import {
  pickPrimaryColorParameter,
  buildInstantVariantInputProps,
  INSTANT_SPEED_PRESETS,
  DEFAULT_INSTANT_SPEED,
} from '@/lib/instant-variant';
import type { Parameter } from '@/types';

const p = (over: Partial<Parameter> & Pick<Parameter, 'key' | 'type' | 'value'>): Parameter => ({
  label: over.key,
  group: over.type === 'color' ? 'color' : 'other',
  ...over,
});

describe('pickPrimaryColorParameter', () => {
  it('returns null when there are no color params', () => {
    expect(pickPrimaryColorParameter([
      p({ key: 'fontSize', type: 'range', value: 32 }),
    ])).toBeNull();
  });

  it('prefers explicit primary slot keys', () => {
    const got = pickPrimaryColorParameter([
      p({ key: 'backgroundColor', type: 'color', value: '#000' }),
      p({ key: 'primaryColor', type: 'color', value: '#7C3AED' }),
      p({ key: 'textColor', type: 'color', value: '#fff' }),
    ]);
    expect(got?.key).toBe('primaryColor');
  });

  it('skips background/text when no explicit primary exists', () => {
    const got = pickPrimaryColorParameter([
      p({ key: 'backgroundColor', type: 'color', value: '#000' }),
      p({ key: 'strokeColor', type: 'color', value: '#abc' }),
      p({ key: 'textColor', type: 'color', value: '#fff' }),
    ]);
    expect(got?.key).toBe('strokeColor');
  });

  it('falls back to first color when only chrome colors exist', () => {
    const got = pickPrimaryColorParameter([
      p({ key: 'backgroundColor', type: 'color', value: '#000' }),
      p({ key: 'textColor', type: 'color', value: '#fff' }),
    ]);
    expect(got?.key).toBe('backgroundColor');
  });
});

describe('buildInstantVariantInputProps', () => {
  const template = {
    parameters: [
      p({ key: 'primaryColor', type: 'color', value: '#7C3AED' }),
      p({ key: 'fontSize', type: 'range', value: 64 }),
    ],
  };

  it('returns defaults when no override given', () => {
    expect(buildInstantVariantInputProps(template)).toEqual({
      primaryColor: '#7C3AED',
      fontSize: 64,
    });
  });

  it('applies a matching override', () => {
    expect(buildInstantVariantInputProps(template, { colorKey: 'primaryColor', colorValue: '#ff0' }))
      .toEqual({ primaryColor: '#ff0', fontSize: 64 });
  });

  it('ignores override when key does not exist (stale overrides do not leak)', () => {
    expect(buildInstantVariantInputProps(template, { colorKey: 'ghostKey', colorValue: '#ff0' }))
      .toEqual({ primaryColor: '#7C3AED', fontSize: 64 });
  });

  it('returns a fresh object (caller can rely on shallow inequality)', () => {
    const a = buildInstantVariantInputProps(template);
    const b = buildInstantVariantInputProps(template);
    expect(a).not.toBe(b);
  });
});

describe('INSTANT_SPEED_PRESETS', () => {
  it('exposes 0.5x / 1x / 2x', () => {
    expect(INSTANT_SPEED_PRESETS.map(p => p.value)).toEqual([0.5, 1, 2]);
  });

  it('default speed is 1x and is included in presets', () => {
    expect(DEFAULT_INSTANT_SPEED).toBe(1);
    expect(INSTANT_SPEED_PRESETS.some(p => p.value === DEFAULT_INSTANT_SPEED)).toBe(true);
  });
});
