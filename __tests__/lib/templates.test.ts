import { getTemplates } from '@/lib/templates';

describe('getTemplates — full composition templates (TM-27)', () => {
  it('registers ProductIntro, DataStory, HighlightReel as composition category', async () => {
    const templates = await getTemplates();
    const composition = templates.filter(t => t.category === 'composition');
    const ids = composition.map(t => t.id).sort();
    expect(ids).toEqual(['data-story', 'highlight-reel', 'product-intro']);
  });

  it('full-composition templates have 30s+ duration and proper fps', async () => {
    const templates = await getTemplates();
    const expectations = {
      'product-intro': 1800,
      'data-story': 1350,
      'highlight-reel': 900,
    };
    for (const [id, frames] of Object.entries(expectations)) {
      const t = templates.find(tpl => tpl.id === id);
      expect(t).toBeDefined();
      expect(t!.durationInFrames).toBe(frames);
      expect(t!.fps).toBe(30);
      expect(t!.durationInFrames / t!.fps).toBeGreaterThanOrEqual(30);
    }
  });

  it('exposes text-slot PARAMS for caption customization', async () => {
    const templates = await getTemplates();
    const productIntro = templates.find(t => t.id === 'product-intro')!;
    const paramKeys = productIntro.parameters.map(p => p.key);
    expect(paramKeys).toEqual(expect.arrayContaining([
      'productName',
      'tagline',
      'feature1Title',
      'feature1Body',
      'ctaText',
    ]));
    // text params should be detected
    const productName = productIntro.parameters.find(p => p.key === 'productName')!;
    expect(productName.type).toBe('text');
    expect(productName.group).toBe('text');
  });

  it('exposes color-slot PARAMS', async () => {
    const templates = await getTemplates();
    const dataStory = templates.find(t => t.id === 'data-story')!;
    const colorParams = dataStory.parameters.filter(p => p.type === 'color');
    expect(colorParams.length).toBeGreaterThanOrEqual(3);
    expect(colorParams.map(p => p.key)).toEqual(
      expect.arrayContaining(['primaryColor', 'backgroundColor'])
    );
  });

  it('jsCode contains Sequence segments for full compositions', async () => {
    const templates = await getTemplates();
    for (const id of ['product-intro', 'data-story', 'highlight-reel']) {
      const t = templates.find(tpl => tpl.id === id)!;
      expect(t.jsCode).toContain('Sequence');
      // section markers in source code (preserved as comments may be stripped after transpile)
      expect(t.code).toMatch(/section:\s*intro/);
      expect(t.code).toMatch(/section:\s*outro/);
    }
  });
});
