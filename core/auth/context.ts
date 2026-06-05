import { AppError } from '../errors.js';

export type Role = 'owner' | 'member';

export interface AuthContext {
  userId: string;
  orgId: string | null;
  membershipId: string | null;
  role: Role | null;
  allowedPropertyIds: string[] | null;
}

export type OrgScopedAuthContext = AuthContext & {
  orgId: string;
  membershipId: string;
  role: Role;
};

export function canSeeProperty(ctx: AuthContext, propertyId: string): boolean {
  if (ctx.role === 'owner') return true;
  return ctx.allowedPropertyIds?.includes(propertyId) ?? false;
}

export function requirePropertyAccess(ctx: AuthContext, propertyId: string): void {
  if (!canSeeProperty(ctx, propertyId)) {
    throw new AppError('forbidden', `no access to property ${propertyId}`);
  }
}

export function requireOrg(ctx: AuthContext): asserts ctx is OrgScopedAuthContext {
  if (!ctx.orgId || !ctx.membershipId || !ctx.role) {
    throw new AppError('forbidden', 'no organization in context');
  }
}
