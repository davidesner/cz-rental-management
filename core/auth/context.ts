import { AppError } from '../errors.js';

export type Role = 'owner' | 'member';

export interface AuthContext {
  userId: string;
  orgId: string;
  membershipId: string;
  role: Role;
  /** null = owner, sees all properties in org. Array = explicit per-property scope. */
  allowedPropertyIds: string[] | null;
}

export function canSeeProperty(ctx: AuthContext, propertyId: string): boolean {
  if (ctx.role === 'owner') return true;
  return ctx.allowedPropertyIds?.includes(propertyId) ?? false;
}

export function requirePropertyAccess(ctx: AuthContext, propertyId: string): void {
  if (!canSeeProperty(ctx, propertyId)) {
    throw new AppError('forbidden', `no access to property ${propertyId}`);
  }
}
