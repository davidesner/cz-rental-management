import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { loadKey } from '../../core/lib/crypto-box.js';
import { fetchMessagesOverImap } from '../../core/lib/imap-fetcher.js';
import {
  requireOwner, listBankIntegrations, getBankIntegration, createBankIntegration,
  updateBankIntegration, deleteBankIntegration, testBankIntegration,
} from '../../core/services/bank-integration.js';
import {
  listBankTransactions, assignBankTransaction, ignoreBankTransaction, reparseBankTransaction,
} from '../../core/services/bank-transaction.js';
import { getPaymentRule, upsertPaymentRule, deletePaymentRule } from '../../core/services/payment-rule.js';
import { syncIntegration, syncAllActiveIntegrations } from '../../core/services/bank-sync.js';
import type { AppEnv } from '../app.js';

const Haler = z.number().int();

const CreateIntegration = z.object({
  name: z.string().min(1),
  imapHost: z.string().min(1),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapUser: z.string().min(1),
  imapPassword: z.string().min(1),
  imapFolder: z.string().min(1).optional(),
  fromFilter: z.string().min(1).optional(),
  subjectFilter: z.string().min(1).optional(),
  accountNumber: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

const UpdateIntegration = CreateIntegration.partial();

const RuleBody = z.object({
  counterpartyAccount: z.string().nullable().optional(),
  vs: z.string().nullable().optional(),
  ks: z.string().nullable().optional(),
  ss: z.string().nullable().optional(),
  amountFrom: Haler.nullable().optional(),
  amountTo: Haler.nullable().optional(),
  active: z.boolean().optional(),
});

const AssignBody = z.object({
  contractId: z.string().min(1),
  // The human override for duplicate detection: the inbox's „Není duplikát —
  // spárovat" click. Optional, so a careless assign is still refused.
  confirmDuplicate: z.boolean().optional(),
});

const StatusFilter = z.enum(['unmatched', 'matched', 'ambiguous', 'suspected_duplicate', 'ignored', 'parse_failed']).optional();

function bankKey(): Buffer {
  // Deliberately NOT wrapped in an AppError. A missing or malformed
  // BANK_SECRET_KEY is a SERVER misconfiguration, and AppError('bad_request')
  // maps to HTTP 400 — which tells the client their request was malformed when
  // the deployment is the thing that is broken. core/errors.ts has no
  // 'internal' kind, so letting the plain Error propagate is the correct
  // choice: it reaches errorMiddleware's generic branch, which console.error's
  // the cause for the operator and returns a 500 that leaks nothing to the
  // caller. cronRoutes() already calls loadKey bare for the identical failure,
  // so this also makes the two entry points report it the same way instead of
  // 400-here / 500-there during a real misconfiguration incident.
  return loadKey(process.env['BANK_SECRET_KEY']);
}

export function bankRoutes() {
  const r = new Hono<AppEnv>();

  // ── Integrations (owner-only) ─────────────────────────────────────────────
  r.get('/bank-integrations', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    return c.json({ bankIntegrations: await listBankIntegrations(c.get('db'), ctx.orgId) });
  });

  r.post('/bank-integrations', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    const body = CreateIntegration.parse(await c.req.json());
    const row = await createBankIntegration(c.get('db'), ctx.orgId, bankKey(), body);
    return c.json({ bankIntegration: row }, 201);
  });

  r.get('/bank-integrations/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    return c.json({ bankIntegration: await getBankIntegration(c.get('db'), ctx.orgId, c.req.param('id')) });
  });

  r.patch('/bank-integrations/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    const body = UpdateIntegration.parse(await c.req.json());
    return c.json({ bankIntegration: await updateBankIntegration(c.get('db'), ctx.orgId, c.req.param('id'), bankKey(), body) });
  });

  r.delete('/bank-integrations/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    await deleteBankIntegration(c.get('db'), ctx.orgId, c.req.param('id'));
    return c.body(null, 204);
  });

  r.post('/bank-integrations/:id/test', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    return c.json(await testBankIntegration(c.get('db'), ctx.orgId, c.req.param('id'), bankKey()));
  });

  r.post('/bank-integrations/:id/sync', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    // Ownership check BEFORE syncIntegration, which resolves orgId from the row
    // itself and would otherwise happily sync another org's mailbox.
    await getBankIntegration(c.get('db'), ctx.orgId, c.req.param('id'));
    const result = await syncIntegration(
      c.get('db'), c.req.param('id'),
      { fetchMessages: fetchMessagesOverImap, key: bankKey() },
      'manual',
    );
    return c.json({ result });
  });

  // ── Transactions (owner-only) ─────────────────────────────────────────────
  r.get('/bank-transactions', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    // safeParse, not parse: this is a QUERY param, which is a thing a user can
    // edit in the address bar, and a ZodError here becomes an HTTP 500. An
    // unrecognised value means "no filter" rather than a server error. (The
    // global ZodError -> 400 mapping is a separate change.)
    const parsedStatus = StatusFilter.safeParse(c.req.query('status'));
    const status = parsedStatus.success ? parsedStatus.data : undefined;
    const pending = c.req.query('pending') === '1';
    return c.json({
      bankTransactions: await listBankTransactions(c.get('db'), ctx.orgId, {
        status, pendingOnly: pending,
      }),
    });
  });

  r.post('/bank-transactions/:id/assign', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    const { contractId, confirmDuplicate } = AssignBody.parse(await c.req.json());
    return c.json({
      bankTransaction: await assignBankTransaction(
        c.get('db'), ctx.orgId, c.req.param('id'), contractId, confirmDuplicate ?? false,
      ),
    });
  });

  r.post('/bank-transactions/:id/ignore', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    return c.json({ bankTransaction: await ignoreBankTransaction(c.get('db'), ctx.orgId, c.req.param('id')) });
  });

  r.post('/bank-transactions/:id/reparse', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    return c.json({ bankTransaction: await reparseBankTransaction(c.get('db'), ctx.orgId, c.req.param('id')) });
  });

  // ── Per-contract rule (normal property access) ────────────────────────────
  r.get('/contracts/:id/payment-rule', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    return c.json(await getPaymentRule(c.get('db'), ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds));
  });

  r.put('/contracts/:id/payment-rule', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = RuleBody.parse(await c.req.json());
    return c.json({ rule: await upsertPaymentRule(c.get('db'), ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds, body) });
  });

  r.delete('/contracts/:id/payment-rule', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    await deletePaymentRule(c.get('db'), ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds);
    return c.body(null, 204);
  });

  return r;
}

/**
 * Vercel Cron endpoint.
 *
 * ⚠️ THE ONE PLACE IN THIS CODEBASE WHERE `orgId` DOES NOT COME FROM `ctx`.
 *
 * Vercel Cron issues an unauthenticated GET with `Authorization: Bearer
 * $CRON_SECRET`, so there is no session and no membership to scope by — the
 * handler iterates every active integration across all orgs and passes each
 * integration's OWN orgId down. That is safe only because the route reads
 * nothing from the request but the secret. Registered BEFORE authMiddleware in
 * server/app.ts; tests/bank-routes.test.ts pins the 401 behaviour, including
 * with CRON_SECRET unset.
 */
export function cronRoutes() {
  const r = new Hono<AppEnv>();

  r.get('/cron/bank-sync', async (c) => {
    const secret = process.env['CRON_SECRET'];
    const header = c.req.header('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    // An unset secret means refuse everything. Running open would be worse than
    // not running: it exposes an endpoint that hits every mailbox in the system.
    if (!secret || presented === '') return c.json({ error: 'unauthorized' }, 401);
    const a = Buffer.from(presented);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ error: 'unauthorized' }, 401);

    const results = await syncAllActiveIntegrations(c.get('db'), {
      fetchMessages: fetchMessagesOverImap,
      key: loadKey(process.env['BANK_SECRET_KEY']),
    });
    return c.json({ results });
  });

  return r;
}
