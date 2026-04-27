import { effectiveMode } from '@/components/studio/PromptPanel';

describe('effectiveMode', () => {
  it("returns 'generate' when no asset, regardless of override", () => {
    expect(effectiveMode(false, null)).toBe('generate');
    expect(effectiveMode(false, 'edit')).toBe('generate');
    expect(effectiveMode(false, 'generate')).toBe('generate');
  });

  it("defaults to 'edit' when an asset exists and no user override", () => {
    expect(effectiveMode(true, null)).toBe('edit');
  });

  it('honors user override when an asset exists', () => {
    expect(effectiveMode(true, 'generate')).toBe('generate');
    expect(effectiveMode(true, 'edit')).toBe('edit');
  });
});
