import path from 'node:path';
// TM-133: server-only loader split out of `manifest.ts`. Pure types/regex
// stay in `manifest-types`; fs-touching helpers live in `manifest-loader`.
import {
  AUDIO_MOODS,
  AudioManifestError,
  parseAudioManifest,
} from '@/lib/audio/manifest-types';
import {
  DEFAULT_MANIFEST_PATH,
  hashAudioAsset,
  loadAudioManifest,
  verifyAudioCatalogueIntegrity,
} from '@/lib/audio/manifest-loader';

const FIXTURE_PATH = path.join(process.cwd(), 'public', 'audio', 'MANIFEST.json');

const makeTrack = (overrides: Record<string, unknown> = {}) => ({
  filename: 'chill-sample.mp3',
  mood: 'chill',
  bpm: 90,
  durationSec: 10,
  license: 'CC0-1.0',
  attribution: 'Test author',
  sha256: 'a'.repeat(64),
  ...overrides,
});

const makeManifest = (tracks: Array<Record<string, unknown>> = [makeTrack()]) => ({
  version: 1,
  tracks,
});

describe('parseAudioManifest', () => {
  it('accepts a well-formed manifest', () => {
    const m = parseAudioManifest(makeManifest());
    expect(m.tracks).toHaveLength(1);
    expect(m.tracks[0].mood).toBe('chill');
  });

  it('rejects non-object input', () => {
    expect(() => parseAudioManifest(null)).toThrow(AudioManifestError);
    expect(() => parseAudioManifest([])).toThrow(AudioManifestError);
  });

  it('rejects unsupported version', () => {
    expect(() => parseAudioManifest({ version: 2, tracks: [makeTrack()] })).toThrow(
      /unsupported manifest version/,
    );
  });

  it('rejects empty track list', () => {
    expect(() => parseAudioManifest(makeManifest([]))).toThrow(/must not be empty/);
  });

  it('rejects bad filename pattern', () => {
    expect(() =>
      parseAudioManifest(makeManifest([makeTrack({ filename: 'BadName.MP3' })])),
    ).toThrow(/filename/);
    expect(() =>
      parseAudioManifest(makeManifest([makeTrack({ filename: '../escape.mp3' })])),
    ).toThrow(/filename/);
  });

  it('rejects duplicate filenames', () => {
    expect(() =>
      parseAudioManifest(
        makeManifest([makeTrack(), makeTrack({ sha256: 'b'.repeat(64) })]),
      ),
    ).toThrow(/duplicate/);
  });

  it('rejects mood outside the closed enum', () => {
    expect(() =>
      parseAudioManifest(makeManifest([makeTrack({ mood: 'jazz' })])),
    ).toThrow(/mood must be one of/);
  });

  it('rejects non-positive bpm / duration', () => {
    expect(() =>
      parseAudioManifest(makeManifest([makeTrack({ bpm: 0 })])),
    ).toThrow(/bpm/);
    expect(() =>
      parseAudioManifest(makeManifest([makeTrack({ durationSec: -1 })])),
    ).toThrow(/durationSec/);
  });

  it('rejects malformed sha256', () => {
    expect(() =>
      parseAudioManifest(makeManifest([makeTrack({ sha256: 'XYZ' })])),
    ).toThrow(/sha256/);
  });
});

describe('hashAudioAsset', () => {
  it('produces lowercase 64-char hex', () => {
    const h = hashAudioAsset(Buffer.from('hello'));
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    // reference value for "hello"
    expect(h).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});

describe('loadAudioManifest (real fixture)', () => {
  it('loads + validates the shipped catalogue', async () => {
    const m = await loadAudioManifest(DEFAULT_MANIFEST_PATH);
    expect(m.version).toBe(1);
    expect(m.tracks.length).toBeGreaterThanOrEqual(10);
    expect(m.tracks.length).toBeLessThanOrEqual(20);
    for (const t of m.tracks) {
      expect(AUDIO_MOODS).toContain(t.mood);
    }
    // every mood should have at least one track
    const moods = new Set(m.tracks.map((t) => t.mood));
    expect(moods.size).toBe(AUDIO_MOODS.length);
  });

  it('catalogue files exist and sha256 matches the manifest', async () => {
    const m = await loadAudioManifest(FIXTURE_PATH);
    const issues = await verifyAudioCatalogueIntegrity(
      m,
      path.dirname(FIXTURE_PATH),
    );
    expect(issues).toEqual([]);
  });

  it('throws AudioManifestError for missing path', async () => {
    await expect(loadAudioManifest('/no/such/manifest.json')).rejects.toThrow(
      AudioManifestError,
    );
  });
});
