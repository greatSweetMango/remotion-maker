import { checkGenerationLimit, checkEditLimit } from '@/lib/usage';

describe('checkGenerationLimit', () => {
  it('allows FREE user within limit', () => {
    expect(checkGenerationLimit({ tier: 'FREE', monthlyUsage: 2 })).toEqual({ allowed: true });
  });

  it('blocks FREE user at limit', () => {
    const result = checkGenerationLimit({ tier: 'FREE', monthlyUsage: 3 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('limit');
  });

  it('allows PRO user within limit', () => {
    expect(checkGenerationLimit({ tier: 'PRO', monthlyUsage: 150 })).toEqual({ allowed: true });
  });

  it('blocks PRO user at limit', () => {
    expect(checkGenerationLimit({ tier: 'PRO', monthlyUsage: 200 }).allowed).toBe(false);
  });
});

describe('checkEditLimit', () => {
  it('allows FREE user with edits under 3', () => {
    expect(checkEditLimit({ tier: 'FREE', editCount: 2 })).toEqual({ allowed: true });
  });

  it('blocks FREE user at 3 edits for same asset', () => {
    expect(checkEditLimit({ tier: 'FREE', editCount: 3 }).allowed).toBe(false);
  });

  it('always allows PRO user', () => {
    expect(checkEditLimit({ tier: 'PRO', editCount: 999 })).toEqual({ allowed: true });
  });
});
