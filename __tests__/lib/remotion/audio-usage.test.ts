import { describe, it, expect } from '@jest/globals';
import {
  compositionUsesAudio,
  sharedAudioTagsForAsset,
} from '@/lib/remotion/audio-usage';

describe('TM-179 compositionUsesAudio', () => {
  it('returns false for empty / null / undefined input', () => {
    expect(compositionUsesAudio(null)).toBe(false);
    expect(compositionUsesAudio(undefined)).toBe(false);
    expect(compositionUsesAudio('')).toBe(false);
  });

  it('returns false for visual-only TSX (most generated assets)', () => {
    const code = `
      export default function Comp() {
        return <AbsoluteFill><div style={{ background: 'red' }} /></AbsoluteFill>;
      }
    `;
    expect(compositionUsesAudio(code)).toBe(false);
  });

  it('returns true for raw <Audio> JSX', () => {
    const code = `<Audio src={staticFile("audio/x.mp3")} />`;
    expect(compositionUsesAudio(code)).toBe(true);
  });

  it('returns true for <CatalogueAudio>', () => {
    const code = `<CatalogueAudio track={bgmTrack} />`;
    expect(compositionUsesAudio(code)).toBe(true);
  });

  it('returns true for transpiled _jsx(Audio, …)', () => {
    const code = `return _jsx(Audio, { src: "x.mp3" });`;
    expect(compositionUsesAudio(code)).toBe(true);
  });

  it('returns true for transpiled jsxs(CatalogueAudio, …)', () => {
    const code = `return jsxs(CatalogueAudio, { track: t });`;
    expect(compositionUsesAudio(code)).toBe(true);
  });

  it('returns true for React.createElement(Audio, …)', () => {
    const code = `React.createElement(Audio, { src: "x.mp3" })`;
    expect(compositionUsesAudio(code)).toBe(true);
  });

  it('does NOT false-match user components with Audio prefix', () => {
    // TM-123 guarantee — `<AudioBars>` / `<AudioVisualizer>` are NOT
    // audio tags, they're visual components named "Audio…". The
    // boundary regex must let them through unflagged.
    expect(compositionUsesAudio(`<AudioBars width={100} />`)).toBe(false);
    expect(compositionUsesAudio(`<AudioVisualizer />`)).toBe(false);
    expect(compositionUsesAudio(`_jsx(AudioBars, { width: 100 })`)).toBe(false);
    expect(compositionUsesAudio(`createElement(AudioVisualizer)`)).toBe(false);
  });

  it('does NOT false-match audio-themed identifiers', () => {
    // String content mentioning audio shouldn't trigger
    expect(compositionUsesAudio(`const label = "audio bars"`)).toBe(false);
    expect(compositionUsesAudio(`const Audio_unused = null`)).toBe(false);
    expect(compositionUsesAudio(`function setupAudioContext() {}`)).toBe(false);
  });
});

describe('TM-179 sharedAudioTagsForAsset', () => {
  it('returns 0 for visual-only assets (no audio cascade)', () => {
    expect(sharedAudioTagsForAsset('<div />')).toBe(0);
    expect(sharedAudioTagsForAsset(null)).toBe(0);
  });

  it('returns 5 (Remotion default) for assets that use audio', () => {
    expect(sharedAudioTagsForAsset(`<CatalogueAudio track="x" />`)).toBe(5);
    expect(sharedAudioTagsForAsset(`<Audio src="x.mp3" />`)).toBe(5);
  });
});
