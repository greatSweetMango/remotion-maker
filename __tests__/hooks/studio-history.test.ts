/**
 * TM-91: undo/redo history layer for the customize panel.
 *
 * Reducer-level unit tests — covers the pure logic without needing a React
 * env. (`useStudio` itself is tested through its consumers in component tests
 * + the existing customize-roundtrip suite.)
 */
import { studioReducer, initialState, HISTORY_DEPTH } from '@/hooks/useStudio';
import type { GeneratedAsset, StudioState } from '@/types';

const asset: GeneratedAsset = {
  id: 'asset-1',
  title: 'test',
  code: '/* tsx */',
  jsCode: '/* js */',
  parameters: [
    { key: 'opacity', label: 'Opacity', group: 'other', type: 'range', value: 0, min: 0, max: 100, step: 1 },
  ],
  durationInFrames: 60,
  fps: 30,
  width: 1920,
  height: 1080,
};

function bootstrap(): StudioState {
  return studioReducer(initialState, { type: 'SET_ASSET', payload: asset });
}

function update(state: StudioState, value: number): StudioState {
  return studioReducer(state, { type: 'UPDATE_PARAM', payload: { key: 'opacity', value } });
}

describe('studioReducer — undo/redo (TM-91)', () => {
  it('starts with empty history after SET_ASSET', () => {
    const s = bootstrap();
    expect(s.history.past).toEqual([]);
    expect(s.history.future).toEqual([]);
    expect(s.paramValues.opacity).toBe(0);
  });

  it('UPDATE_PARAM pushes a snapshot and clears future', () => {
    let s = bootstrap();
    s = update(s, 10);
    expect(s.paramValues.opacity).toBe(10);
    expect(s.history.past).toHaveLength(1);
    expect(s.history.past[0]?.opacity).toBe(0);
    expect(s.history.future).toEqual([]);
  });

  it('UPDATE_PARAM with same value is a no-op (does not pollute history)', () => {
    let s = bootstrap();
    s = update(s, 0); // same as initial
    expect(s.history.past).toHaveLength(0);
  });

  it('50 changes followed by 50 undos returns to initial', () => {
    let s = bootstrap();
    for (let i = 1; i <= 50; i++) s = update(s, i);
    expect(s.paramValues.opacity).toBe(50);
    expect(s.history.past).toHaveLength(50);

    for (let i = 0; i < 50; i++) s = studioReducer(s, { type: 'UNDO' });
    expect(s.paramValues.opacity).toBe(0);
    expect(s.history.past).toHaveLength(0);
    expect(s.history.future).toHaveLength(50);

    // Extra undo is a no-op (defensive — UI should disable the button anyway).
    const before = s;
    s = studioReducer(s, { type: 'UNDO' });
    expect(s).toBe(before);
  });

  it('redo replays the future', () => {
    let s = bootstrap();
    s = update(s, 1);
    s = update(s, 2);
    s = update(s, 3);
    s = studioReducer(s, { type: 'UNDO' });
    s = studioReducer(s, { type: 'UNDO' });
    expect(s.paramValues.opacity).toBe(1);

    s = studioReducer(s, { type: 'REDO' });
    expect(s.paramValues.opacity).toBe(2);
    s = studioReducer(s, { type: 'REDO' });
    expect(s.paramValues.opacity).toBe(3);
    // Extra redo is a no-op.
    const before = s;
    s = studioReducer(s, { type: 'REDO' });
    expect(s).toBe(before);
  });

  it('branching: a new edit after undo clears the redo stack', () => {
    let s = bootstrap();
    s = update(s, 1);
    s = update(s, 2);
    s = update(s, 3);
    // Undo twice → present=1, future has [2, 3]
    s = studioReducer(s, { type: 'UNDO' });
    s = studioReducer(s, { type: 'UNDO' });
    expect(s.paramValues.opacity).toBe(1);
    expect(s.history.future).toHaveLength(2);

    // Branch: introduce a new value. Future MUST be wiped.
    s = update(s, 99);
    expect(s.paramValues.opacity).toBe(99);
    expect(s.history.future).toHaveLength(0);
    // past = [initial(0), 1] before branch + new push of {1} = [0, 1]
    expect(s.history.past).toHaveLength(2);
    expect(s.history.past[0]?.opacity).toBe(0);
    expect(s.history.past[1]?.opacity).toBe(1);
  });

  it(`enforces depth cap of ${HISTORY_DEPTH}`, () => {
    let s = bootstrap();
    // Make HISTORY_DEPTH + 25 distinct edits.
    const total = HISTORY_DEPTH + 25;
    for (let i = 1; i <= total; i++) s = update(s, i);
    expect(s.paramValues.opacity).toBe(total);
    expect(s.history.past.length).toBe(HISTORY_DEPTH);
    // Oldest retained snapshot should be the value just before edit #(total - HISTORY_DEPTH + 1).
    // I.e. value at index 0 of past = (total - HISTORY_DEPTH).
    expect(s.history.past[0]?.opacity).toBe(total - HISTORY_DEPTH);
    // Newest retained snapshot = value just before the last update = total - 1.
    expect(s.history.past[HISTORY_DEPTH - 1]?.opacity).toBe(total - 1);
  });

  it('history resets on SET_ASSET / ADD_VERSION / RESTORE_VERSION', () => {
    let s = bootstrap();
    s = update(s, 5);
    s = update(s, 10);
    expect(s.history.past).toHaveLength(2);

    // SET_ASSET resets.
    const reset1 = studioReducer(s, { type: 'SET_ASSET', payload: asset });
    expect(reset1.history.past).toEqual([]);
    expect(reset1.history.future).toEqual([]);

    // ADD_VERSION resets.
    const reset2 = studioReducer(s, {
      type: 'ADD_VERSION',
      payload: {
        id: 'v2',
        code: '',
        jsCode: '',
        parameters: asset.parameters,
        prompt: 'edit',
        createdAt: new Date().toISOString(),
      },
    });
    expect(reset2.history.past).toEqual([]);
    expect(reset2.history.future).toEqual([]);

    // RESTORE_VERSION resets.
    const reset3 = studioReducer(s, { type: 'RESTORE_VERSION', payload: 0 });
    expect(reset3.history.past).toEqual([]);
    expect(reset3.history.future).toEqual([]);
  });
});
