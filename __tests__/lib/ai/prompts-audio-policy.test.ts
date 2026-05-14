/**
 * TM-129 / ADR-0026 §3 — Edit-prompt audio policy.
 *
 * The TM-123 hard-deny on `<Audio>` was relaxed in TM-128 (sandbox
 * structural allow-list) and TM-127 (curated catalogue manifest). The
 * generation system prompt must now teach the LLM:
 *
 *   1. Video / OffthreadVideo / IFrame remain DENIED.
 *   2. <Audio> is allowed ONLY through the literal
 *      `<Audio src={staticFile('audio/<slug>.mp3')} />` shape.
 *   3. The catalogue moods (chill, upbeat, cinematic, lofi, electronic)
 *      are the canonical mood tags.
 *   4. PARAMS bgmTrack convention exists for the TM-130 picker.
 *
 * If a future refactor drops these, this test goes red and we know cache
 * invalidation (ADR-0003) is the next concern, not silent regression.
 */
import {
  GENERATION_SYSTEM_PROMPT,
  GENERATION_WITH_CLARIFY_SYSTEM_PROMPT,
} from '@/lib/ai/prompts';
import { AUDIO_MOODS } from '@/lib/audio/manifest';

describe('GENERATION_SYSTEM_PROMPT — TM-129 audio catalogue policy', () => {
  it('keeps Video / OffthreadVideo / IFrame in the deny list', () => {
    // The hard-deny on these stays — only <Audio> was relaxed.
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/<Video>/);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/<OffthreadVideo>/);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/<IFrame>/);
    // and the verb "DO NOT use" (or equivalent) appears near them.
    expect(GENERATION_SYSTEM_PROMPT).toMatch(
      /DO NOT use[^]*<Video>[^]*<OffthreadVideo>[^]*<IFrame>/,
    );
  });

  it('removes the blanket "NEVER emit <Audio>" sentence (TM-123 hard-deny)', () => {
    // Sanity that the TM-123 wording is gone — otherwise the LLM will keep
    // refusing audio even after TM-128 unlocked it.
    expect(GENERATION_SYSTEM_PROMPT).not.toMatch(/NEVER emit `?<Audio>`?/);
  });

  it('teaches the literal staticFile audio shape (TM-128 allow-list)', () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/staticFile\(\s*['"]audio\//);
    // The actual catalogue path shape, not just a generic mention.
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/<Audio\b/);
  });

  it('warns against variable / template-string staticFile arguments', () => {
    // The model must understand that staticFile(PARAMS.bgmTrack) WILL be
    // rejected — without this warning it will "helpfully" wire the picker
    // through a runtime variable and trip the sandbox.
    expect(GENERATION_SYSTEM_PROMPT).toMatch(
      /staticFile\(PARAMS\.bgmTrack\)|variable.*src|literal/i,
    );
  });

  it('lists every TM-127 catalogue mood verbatim', () => {
    for (const mood of AUDIO_MOODS) {
      expect(GENERATION_SYSTEM_PROMPT).toContain(mood);
    }
  });

  it('mentions the bgmTrack PARAMS convention for the TM-130 picker', () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/bgmTrack/);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/type:\s*bgmTrack/);
  });

  it('frames audio as OPTIONAL — keeps "visual cues" fallback', () => {
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/OPTIONAL|optional/);
    // The TM-123 visual-cue guidance (pulses, equalizer bars) remains so
    // purely visual prompts don't suddenly start force-injecting audio.
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/equalizer|pulsing|Math\.sin/);
  });

  it('GENERATION_WITH_CLARIFY_SYSTEM_PROMPT inherits the audio policy', () => {
    expect(GENERATION_WITH_CLARIFY_SYSTEM_PROMPT).toMatch(/staticFile\(\s*['"]audio\//);
    expect(GENERATION_WITH_CLARIFY_SYSTEM_PROMPT).toMatch(/bgmTrack/);
    for (const mood of AUDIO_MOODS) {
      expect(GENERATION_WITH_CLARIFY_SYSTEM_PROMPT).toContain(mood);
    }
  });
});
