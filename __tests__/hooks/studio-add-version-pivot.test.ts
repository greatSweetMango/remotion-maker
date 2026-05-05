/**
 * TM-106 — ADD_VERSION must pivot `state.asset.id` to the server-side DB id
 * when an edit on a template-backed asset materializes a fresh row.
 *
 * Surface symptom of the missing pivot: every subsequent edit sent
 * `assetId: "template-…"` to /api/edit, which (a) created another orphan
 * DB asset on every edit and (b) accumulated editUsage under the template
 * path-key so FREE users hit "Edit limit reached" after 3 edits even
 * though each landed in a different DB row. On refresh, the URL still
 * carried `?template=…`, re-bootstrapping the original code and silently
 * discarding all edits — the user-visible "edit doesn't work" report.
 */
import { studioReducer, initialState } from '@/hooks/useStudio';
import type { AssetVersion, GeneratedAsset, StudioState } from '@/types';

const templateAsset: GeneratedAsset = {
  id: 'template-counter-animation',
  title: 'Counter Animation',
  code: '/* original */',
  jsCode: '/* original-js */',
  parameters: [
    { key: 'primaryColor', label: 'Primary Color', group: 'color', type: 'color', value: '#FF0000' },
  ],
  durationInFrames: 150,
  fps: 30,
  width: 1920,
  height: 1080,
};

const editedVersion: AssetVersion = {
  id: 'client-uuid-1',
  code: '/* edited */',
  jsCode: '/* edited-js */',
  parameters: [
    { key: 'primaryColor', label: 'Primary Color', group: 'color', type: 'color', value: '#0000FF' },
  ],
  prompt: 'turn it blue',
  createdAt: new Date('2026-04-27').toISOString(),
};

function bootstrap(): StudioState {
  return studioReducer(initialState, { type: 'SET_ASSET', payload: templateAsset });
}

describe('studioReducer ADD_VERSION — TM-106 template→asset pivot', () => {
  it('keeps state.asset.id unchanged when newAssetId is omitted', () => {
    const s0 = bootstrap();
    const s1 = studioReducer(s0, { type: 'ADD_VERSION', payload: editedVersion });
    expect(s1.asset?.id).toBe('template-counter-animation');
    expect(s1.asset?.code).toBe('/* edited */');
    expect(s1.versions).toHaveLength(2);
  });

  it('pivots state.asset.id to newAssetId when supplied (template→DB row)', () => {
    const s0 = bootstrap();
    const s1 = studioReducer(s0, {
      type: 'ADD_VERSION',
      payload: editedVersion,
      newAssetId: 'cmospxxd10006dm733usp9r9l',
      newTitle: 'Modified Animation with Blue Color',
    });
    expect(s1.asset?.id).toBe('cmospxxd10006dm733usp9r9l');
    expect(s1.asset?.title).toBe('Modified Animation with Blue Color');
    expect(s1.asset?.code).toBe('/* edited */');
    // versions/paramValues still update normally
    expect(s1.versions).toHaveLength(2);
    expect(s1.paramValues.primaryColor).toBe('#0000FF');
    expect(s1.isEditing).toBe(false);
  });

  it('does not overwrite title when newTitle is omitted', () => {
    const s0 = bootstrap();
    const s1 = studioReducer(s0, {
      type: 'ADD_VERSION',
      payload: editedVersion,
      newAssetId: 'cmABCD',
    });
    expect(s1.asset?.id).toBe('cmABCD');
    expect(s1.asset?.title).toBe('Counter Animation');
  });

  it('is a no-op (asset stays null) when there is no current asset', () => {
    const s1 = studioReducer(initialState, {
      type: 'ADD_VERSION',
      payload: editedVersion,
      newAssetId: 'cmABCD',
    });
    expect(s1.asset).toBeNull();
  });
});
