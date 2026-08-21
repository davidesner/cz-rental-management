import { createId } from '@paralleldrive/cuid2';
import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { bankIntegration } from '../db/schema.js';
import { AppError } from '../errors.js';
import type { AuthContext } from '../auth/context.js';
import { seal, open } from '../lib/crypto-box.js';
import { probeConnection, type ImapConfig } from '../lib/imap-fetcher.js';

/**
 * Bank integrations and the transaction inbox are owner-only.
 *
 * A member restricted to one property must not see org-wide bank traffic: an
 * unassigned transaction is by definition not yet attributable to a property,
 * so allowedPropertyIds cannot express the right answer here.
 */
export function requireOwner(ctx: AuthContext): void {
  if (ctx.role !== 'owner') throw new AppError('forbidden', 'pouze vlastník organizace může spravovat bankovní integrace');
}

export interface BankIntegrationRow {
  id: string;
  orgId: string;
  kind: 'kb_email';
  name: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  /** Never the value — only whether one is stored. */
  imapPasswordSet: boolean;
  imapFolder: string;
  fromFilter: string;
  subjectFilter: string;
  accountNumber: string | null;
  active: boolean;
  lastSyncAt: Date | null;
  lastSyncStatus: 'ok' | 'error' | null;
  lastSyncError: string | null;
  createdAt: Date;
}

// Selecting explicitly rather than `select()` so imapPasswordEnc can never leak
// into a response by someone adding a column later.
const selectShape = {
  id: bankIntegration.id,
  orgId: bankIntegration.orgId,
  kind: bankIntegration.kind,
  name: bankIntegration.name,
  imapHost: bankIntegration.imapHost,
  imapPort: bankIntegration.imapPort,
  imapUser: bankIntegration.imapUser,
  imapFolder: bankIntegration.imapFolder,
  fromFilter: bankIntegration.fromFilter,
  subjectFilter: bankIntegration.subjectFilter,
  accountNumber: bankIntegration.accountNumber,
  active: bankIntegration.active,
  lastSyncAt: bankIntegration.lastSyncAt,
  lastSyncStatus: bankIntegration.lastSyncStatus,
  lastSyncError: bankIntegration.lastSyncError,
  createdAt: bankIntegration.createdAt,
} as const;

function withPasswordFlag(row: Omit<BankIntegrationRow, 'imapPasswordSet'>): BankIntegrationRow {
  return { ...row, imapPasswordSet: true };
}

export interface CreateInput {
  name: string;
  imapHost: string;
  imapPort?: number;
  imapUser: string;
  imapPassword: string;
  imapFolder?: string;
  fromFilter?: string;
  subjectFilter?: string;
  accountNumber?: string | null;
  active?: boolean;
}

export type UpdateInput = Partial<Omit<CreateInput, 'imapPassword'>> & { imapPassword?: string };

export async function listBankIntegrations(db: DB, orgId: string): Promise<BankIntegrationRow[]> {
  const rows = await db.select(selectShape).from(bankIntegration)
    .where(eq(bankIntegration.orgId, orgId))
    .orderBy(desc(bankIntegration.createdAt));
  return rows.map(withPasswordFlag);
}

export async function getBankIntegration(db: DB, orgId: string, id: string): Promise<BankIntegrationRow> {
  const [row] = await db.select(selectShape).from(bankIntegration)
    .where(and(eq(bankIntegration.id, id), eq(bankIntegration.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'bankovní integrace nenalezena');
  return withPasswordFlag(row);
}

export async function createBankIntegration(
  db: DB, orgId: string, key: Buffer, input: CreateInput,
): Promise<BankIntegrationRow> {
  const id = createId();
  await db.insert(bankIntegration).values({
    id, orgId, kind: 'kb_email',
    name: input.name,
    imapHost: input.imapHost,
    imapPort: input.imapPort ?? 993,
    imapUser: input.imapUser,
    imapPasswordEnc: seal(input.imapPassword, key),
    imapFolder: input.imapFolder ?? 'INBOX',
    fromFilter: input.fromFilter ?? 'servis@kbinfo.cz',
    subjectFilter: input.subjectFilter ?? 'Přijali jsme platbu',
    accountNumber: input.accountNumber ?? null,
    active: input.active ?? true,
  });
  return getBankIntegration(db, orgId, id);
}

export async function updateBankIntegration(
  db: DB, orgId: string, id: string, key: Buffer, patch: UpdateInput,
): Promise<BankIntegrationRow> {
  await getBankIntegration(db, orgId, id); // existence + org scope
  const set: Record<string, unknown> = {};
  for (const field of ['name', 'imapHost', 'imapPort', 'imapUser', 'imapFolder', 'fromFilter', 'subjectFilter', 'accountNumber', 'active'] as const) {
    if (patch[field] !== undefined) set[field] = patch[field];
  }
  // An omitted password leaves the stored one untouched — the UI sends a value
  // only when it was actually retyped.
  if (patch.imapPassword !== undefined && patch.imapPassword !== '') {
    set['imapPasswordEnc'] = seal(patch.imapPassword, key);
  }
  if (Object.keys(set).length > 0) {
    await db.update(bankIntegration).set(set).where(and(eq(bankIntegration.id, id), eq(bankIntegration.orgId, orgId)));
  }
  return getBankIntegration(db, orgId, id);
}

export async function deleteBankIntegration(db: DB, orgId: string, id: string): Promise<void> {
  await getBankIntegration(db, orgId, id);
  await db.delete(bankIntegration).where(and(eq(bankIntegration.id, id), eq(bankIntegration.orgId, orgId)));
}

/**
 * Deliberately NOT exported. The returned `ImapConfig` carries the decrypted
 * password in a field literally named `password`, so an exported version is one
 * careless `import` away from a route handler serialising it into a response —
 * which would defeat the write-only-password invariant this whole service is
 * built around. `testBankIntegration` is the only caller; keep it that way, and
 * if another module ever needs a live IMAP config, give it a function that
 * consumes the config rather than one that returns it.
 */
async function loadImapConfig(db: DB, orgId: string, id: string, key: Buffer): Promise<ImapConfig> {
  const [row] = await db.select().from(bankIntegration)
    .where(and(eq(bankIntegration.id, id), eq(bankIntegration.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'bankovní integrace nenalezena');
  return {
    host: row.imapHost, port: row.imapPort, user: row.imapUser,
    password: open(row.imapPasswordEnc, key), folder: row.imapFolder,
  };
}

export async function testBankIntegration(
  db: DB, orgId: string, id: string, key: Buffer,
): Promise<{ ok: boolean; mailboxExists?: number; error?: string }> {
  let cfg: ImapConfig;
  try {
    cfg = await loadImapConfig(db, orgId, id, key);
  } catch (e) {
    if (e instanceof AppError) throw e;
    return { ok: false, error: `nelze dešifrovat heslo — zkontroluj BANK_SECRET_KEY` };
  }
  const result = await probeConnection(cfg);
  return result.ok ? { ok: true, mailboxExists: result.mailboxExists } : { ok: false, error: result.error };
}
