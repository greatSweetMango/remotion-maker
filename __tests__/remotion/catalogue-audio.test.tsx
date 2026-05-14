/**
 * @jest-environment jsdom
 *
 * TM-132 / ADR-0026 §B amendment — `<CatalogueAudio>` wrapper unit tests.
 *
 * The wrapper exists so the customize-tab BGM picker (TM-130) can swap
 * tracks via PARAMS without an LLM round-trip. Two contracts to verify:
 *
 *   1. Invalid `track` shapes render to `null` (no crash, no Html5Audio
 *      error cascade — the very failure mode TM-123 fixed).
 *   2. Valid `track` shapes render a Remotion `<Audio>` whose `src` was
 *      built from `staticFile("audio/<sanitized-slug>.mp3")`.
 *
 * We mock `remotion` so the test does not require a Remotion render
 * context (jsdom alone is fine). The mock captures the `src` prop so we
 * can assert the canonical `audio/...` path was produced.
 */

jest.mock('remotion', () => ({
  staticFile: (p: string) => `/__static__/${p}`,
  Audio: (props: Record<string, unknown>) => {
    // Render a sentinel <audio> element so we can introspect props in jsdom.
    return (
      <audio
        data-testid="remotion-audio"
        data-src={String(props.src ?? '')}
        data-volume={String(props.volume ?? '')}
      />
    );
  },
}));

import React from 'react';
import { render, screen } from '@testing-library/react';
import { CatalogueAudio } from '@/remotion/CatalogueAudio';

describe('<CatalogueAudio>', () => {
  describe('renders <Audio> for valid catalogue tracks', () => {
    it('accepts bare slug (no audio/ prefix)', () => {
      render(<CatalogueAudio track="chill-sunrise.mp3" />);
      const el = screen.getByTestId('remotion-audio');
      expect(el.getAttribute('data-src')).toBe(
        '/__static__/audio/chill-sunrise.mp3',
      );
    });

    it('accepts audio/-prefixed slug (picker canonical form)', () => {
      render(<CatalogueAudio track="audio/upbeat-runner.mp3" />);
      const el = screen.getByTestId('remotion-audio');
      // The wrapper strips the prefix and re-emits canonically — verify the
      // result is a single, well-formed `audio/<slug>.mp3` path with no
      // double prefix (`audio/audio/...`) regression.
      expect(el.getAttribute('data-src')).toBe(
        '/__static__/audio/upbeat-runner.mp3',
      );
    });

    it('forwards volume prop to <Audio>', () => {
      render(<CatalogueAudio track="chill-sunrise.mp3" volume={0.42} />);
      const el = screen.getByTestId('remotion-audio');
      expect(el.getAttribute('data-volume')).toBe('0.42');
    });

    it('uses 0.6 default volume when none specified', () => {
      render(<CatalogueAudio track="chill-sunrise.mp3" />);
      const el = screen.getByTestId('remotion-audio');
      expect(el.getAttribute('data-volume')).toBe('0.6');
    });
  });

  describe('renders null for invalid track shapes (no crash)', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty string', ''],
      ['path traversal', '../etc/passwd'],
      ['audio/ + traversal', 'audio/../secret.mp3'],
      ['external URL', 'https://evil.com/x.mp3'],
      ['wrong extension', 'chill.wav'],
      ['uppercase', 'Chill.mp3'],
      ['nested path', 'subdir/chill.mp3'],
      ['data uri', 'data:audio/mp3;base64,AAAA'],
    ])('returns null for %s', (_label, track) => {
      const { container } = render(
        <CatalogueAudio track={track as string | null | undefined} />,
      );
      expect(container.querySelector('[data-testid="remotion-audio"]')).toBeNull();
      expect(container.firstChild).toBeNull();
    });
  });
});
