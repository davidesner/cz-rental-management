import { describe, it, expect } from 'vitest';
import { canSeeProperty, requirePropertyAccess } from '../core/auth/context.js';
import { AppError } from '../core/errors.js';

const ownerCtx = {
  userId: 'u1',
  orgId: 'o1',
  membershipId: 'm1',
  role: 'owner' as const,
  allowedPropertyIds: null,
};
const memberCtx = {
  userId: 'u2',
  orgId: 'o1',
  membershipId: 'm2',
  role: 'member' as const,
  allowedPropertyIds: ['p1', 'p2'],
};

describe('canSeeProperty', () => {
  it('owner sees everything', () => {
    expect(canSeeProperty(ownerCtx, 'pX')).toBe(true);
  });
  it('member sees only allowed', () => {
    expect(canSeeProperty(memberCtx, 'p1')).toBe(true);
    expect(canSeeProperty(memberCtx, 'pX')).toBe(false);
  });
});

describe('requirePropertyAccess', () => {
  it('throws forbidden when not allowed', () => {
    expect(() => requirePropertyAccess(memberCtx, 'pX')).toThrowError(AppError);
  });
  it('passes for owner', () => {
    expect(() => requirePropertyAccess(ownerCtx, 'pX')).not.toThrow();
  });
});
