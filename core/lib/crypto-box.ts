// Authenticated encryption for secrets we must store but never display —
// currently the IMAP password on bank_integration.
//
// The `v1:` prefix is deliberate: it lets a future scheme (different cipher,
// KDF-derived key, KMS envelope) coexist with rows written today, so key
// rotation becomes an additive change rather than a migration that must
// re-encrypt everything atomically.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for
const KEY_BYTES = 32;

/**
 * Decode and validate the raw base64 key (from BANK_SECRET_KEY).
 *
 * Deliberately takes the string rather than reading process.env itself: core/
 * is framework- and environment-free, and a bad key must fail at a call site
 * that can report it, not at module load.
 */
export function loadKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error('BANK_SECRET_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`BANK_SECRET_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function open(sealed: string, key: Buffer): string {
  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(`unsupported ciphertext format`);
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64!, 'base64url'));
  // Throws on mismatch in final() below — this is what makes a tampered row or
  // a wrong key an error rather than silent garbage.
  decipher.setAuthTag(Buffer.from(tagB64!, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64!, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
