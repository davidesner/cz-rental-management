import { createHash, randomBytes } from 'node:crypto';

const PREFIX = 'rmt_';

export function generateToken(): string {
  return PREFIX + randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
