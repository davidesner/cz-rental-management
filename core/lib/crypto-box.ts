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
const TAG_BYTES = 16; // full 128-bit GCM tag; a truncated one is not accepted on open()
const KEY_BYTES = 32;

/**
 * Decode and validate the raw base64 key (from SECRET_ENCRYPTION_KEY).
 *
 * Deliberately takes the string rather than reading process.env itself: core/
 * is framework- and environment-free, and a bad key must fail at a call site
 * that can report it, not at module load.
 */
export function loadKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error('SECRET_ENCRYPTION_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`SECRET_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`);
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
  const iv = Buffer.from(ivB64!, 'base64url');
  const tag = Buffer.from(tagB64!, 'base64url');
  // Node accepts a SHORT GCM tag (down to 4 bytes) and an IV of any length, and
  // both are read from the stored row. Verified: with these two asserts removed,
  // open() happily accepts the first 4 bytes of a valid tag — GCM tags truncate,
  // so that is not a corrupt value it would reject, it is a WEAKER one it
  // accepts. Forging a value we then decrypt and use as a password drops from
  // 2^128 to 2^32; a non-96-bit IV leaves GCM outside the construction it is
  // specified for. seal() only ever writes 12 and 16, so anything else is
  // tampering or corruption, not a format we support.
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('unsupported ciphertext format');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  // Throws on mismatch in final() below — this is what makes a tampered row or
  // a wrong key an error rather than silent garbage.
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64!, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
