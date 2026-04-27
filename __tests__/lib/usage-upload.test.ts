import { checkUploadLimit } from '@/lib/usage';

describe('checkUploadLimit — images', () => {
  it('allows FREE user under image limit', () => {
    expect(checkUploadLimit({ tier: 'FREE', kind: 'image', currentCount: 4 })).toEqual({ allowed: true });
  });
  it('blocks FREE user at image limit', () => {
    const r = checkUploadLimit({ tier: 'FREE', kind: 'image', currentCount: 5 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/images/i);
  });
  it('allows PRO user well past Free limit', () => {
    expect(checkUploadLimit({ tier: 'PRO', kind: 'image', currentCount: 100 })).toEqual({ allowed: true });
  });
});

describe('checkUploadLimit — fonts', () => {
  it('allows FREE user under font limit', () => {
    expect(checkUploadLimit({ tier: 'FREE', kind: 'font', currentCount: 2 })).toEqual({ allowed: true });
  });
  it('blocks FREE user at font limit', () => {
    const r = checkUploadLimit({ tier: 'FREE', kind: 'font', currentCount: 3 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/fonts/i);
  });
  it('allows PRO user with many fonts', () => {
    expect(checkUploadLimit({ tier: 'PRO', kind: 'font', currentCount: 50 })).toEqual({ allowed: true });
  });
});
