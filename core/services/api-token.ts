import { createId } from '@paralleldrive/cuid2';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { apiToken, membership } from '../db/schema.js';
import { generateToken, hashToken } from '../auth/token.js';
import { AppError } from '../errors.js';

export interface TokenSummary {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export async function issueApiToken(db: DB, membershipId: string, name: string): Promise<{ id: string; token: string; name: string }> {
  const m = await db.select().from(membership).where(eq(membership.id, membershipId)).get();
  if (!m) throw new AppError('not_found', 'membership not found');
  const token = generateToken();
  const id = createId();
  await db.insert(apiToken).values({ id, membershipId, name, tokenHash: hashToken(token) });
  return { id, token, name };
}

export async function listApiTokens(db: DB, membershipId: string): Promise<TokenSummary[]> {
  const rows = await db
    .select({
      id: apiToken.id, name: apiToken.name, lastUsedAt: apiToken.lastUsedAt, createdAt: apiToken.createdAt,
    })
    .from(apiToken)
    .where(eq(apiToken.membershipId, membershipId));
  return rows;
}

export async function revokeApiToken(db: DB, membershipId: string, tokenId: string) {
  const result = await db.delete(apiToken)
    .where(and(eq(apiToken.id, tokenId), eq(apiToken.membershipId, membershipId)));
  if (result.rowsAffected === 0) throw new AppError('not_found', 'token not found');
}
