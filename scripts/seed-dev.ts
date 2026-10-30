// Local development seed: one sign-in and a small fictional portfolio so every
// screen has something to show. Never run this against production.
//
// Usage (reads DATABASE_URL etc. from .env):
//   pnpm tsx scripts/seed-dev.ts
//
// Sign-in it creates (local dev only, override with SEED_EMAIL / SEED_PASSWORD):
//   e-mail   dev@example.test
//   password  spravapronajmu-dev
//
// Running it twice is safe: it stops when the user already exists.

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDb } from '../core/db/client.js';
import { createAuth } from '../core/auth/better-auth.js';
import { user } from '../core/db/schema.js';
import { listOrganizationsForUser } from '../core/services/organization.js';
import { createProperty } from '../core/services/property.js';
import { createTenant } from '../core/services/tenant.js';
import { createContract } from '../core/services/contract.js';
import { addContractTerms } from '../core/services/contract-terms.js';
import { addContractUtility } from '../core/services/contract-utility.js';
import { addPropertyTariff } from '../core/services/property-tariff.js';
import { recordPayment } from '../core/services/payment.js';
import { addRentReduction } from '../core/services/rent-reduction.js';
import { createCostStatement } from '../core/services/cost-statement.js';
import { computeReconciliation, finalizeReconciliation } from '../core/services/reconciliation.js';

const EMAIL = process.env.SEED_EMAIL ?? 'dev@example.test';
const PASSWORD = process.env.SEED_PASSWORD ?? 'spravapronajmu-dev';

const Kc = (czk: number) => Math.round(czk * 100);
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
const day = (y: number, m: number, d: number) => `${ym(y, m)}-${String(d).padStart(2, '0')}`;

/** Every month from `from` (YYYY-MM) up to and including the current month. */
function monthsUntilNow(from: string): Array<[number, number]> {
  const now = new Date();
  const out: Array<[number, number]> = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    out.push([y, m]);
    m += 1; if (m === 13) { m = 1; y += 1; }
  }
  return out;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL must be set');
  const host = new URL(databaseUrl).hostname.replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(host) || /[?&]host=/i.test(databaseUrl)) {
    throw new Error(`refusing to seed a non-local database (host ${host})`);
  }

  process.env.VITEST = 'true'; // enables sign-up for this process only (see scripts/create-user.ts)
  const { db, close } = createDb(databaseUrl);
  try {
    const existing = await db.select().from(user).where(eq(user.email, EMAIL));
    if (existing.length > 0) {
      console.log(`user ${EMAIL} already exists, nothing to do`);
      return;
    }
    const auth = createAuth(db);
    const signUp = await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: 'Dana Vývojová' } });
    const orgs = await listOrganizationsForUser(db, signUp.user.id);
    const org = orgs[0];
    if (!org) throw new Error('sign-up did not create an organization');
    const orgId = org.id;
    const all = null; // owner: every property

    const now = new Date();
    const thisY = now.getFullYear();
    const thisM = now.getMonth() + 1;
    const lastY = thisY - 1;

    // ── Properties ────────────────────────────────────────────────────────
    const lipova = await createProperty(db, orgId, { name: 'Byt 3+1, Lipová 8', address: 'Lipová 8, 120 00 Praha 2', reconciliationSkill: 'svj-lipova' });
    const nadrazni = await createProperty(db, orgId, { name: 'Garsoniéra, Nádražní 41', address: 'Nádražní 41, 602 00 Brno', reconciliationSkill: 'svj-nadrazni' });
    const skolni = await createProperty(db, orgId, { name: 'Byt 2+kk, Školní 27', address: 'Školní 27, 301 00 Plzeň' });
    await createProperty(db, orgId, { name: 'Garáž, Zahradní 5', address: 'Zahradní 5, 370 01 České Budějovice', note: 'Aktuálně bez nájemníka.' });

    for (const [p, from, total, ded] of [
      [lipova, day(lastY - 1, 1, 1), 4400, 1100], [lipova, day(lastY, 1, 1), 4800, 1200], [lipova, day(thisY, 1, 1), 5200, 1300],
      [nadrazni, day(lastY, 1, 1), 2600, 600], [nadrazni, day(thisY, 1, 1), 2900, 650],
    ] as const) {
      await addPropertyTariff(db, orgId, p.id, all, { validFrom: from, totalSvjAdvance: Kc(total), deductibleAmount: Kc(ded), deductibleNote: 'fond oprav + odměny výboru + pojištění', documentRef: `EL-${from.slice(0, 4)}.pdf` });
    }

    // ── Tenants ───────────────────────────────────────────────────────────
    const petra = await createTenant(db, orgId, { name: 'Petra Svobodová', email: 'petra.svobodova@example.test', phone: '+420 601 000 001', accountNumber: '1234567890/0800' });
    const tomas = await createTenant(db, orgId, { name: 'Tomáš Dvořák', email: 'tomas.dvorak@example.test', phone: '+420 601 000 002', accountNumber: '2345678901/0100' });
    const lucie = await createTenant(db, orgId, { name: 'Lucie Veselá', email: 'lucie.vesela@example.test', accountNumber: '3456789012/0300' });
    const jan = await createTenant(db, orgId, { name: 'Jan Novotný', phone: '+420 601 000 004' });

    // ── Contract 1: Petra, Lipová, running since Feb two years ago ────────
    const c1 = await createContract(db, orgId, all, { propertyId: lipova.id, tenantId: petra.id, startDate: day(lastY - 1, 2, 1), securityDeposit: Kc(30000), note: 'Klíče předány 1. 2., stav elektroměru 12 345.' });
    await addContractTerms(db, orgId, c1.id, all, { validFrom: day(lastY - 1, 2, 1), baseRent: Kc(13500), serviceAdvance: Kc(3000), paymentDueDay: 10, source: 'initial', documentRef: 'smlouva-2024.pdf' });
    await addContractUtility(db, orgId, c1.id, all, { kind: 'electricity', validFrom: day(lastY - 1, 2, 1), monthlyAdvance: Kc(1200) });
    await addContractTerms(db, orgId, c1.id, all, { validFrom: day(lastY, 1, 1), baseRent: Kc(14000), serviceAdvance: Kc(3100), paymentDueDay: 10, source: 'addendum', documentRef: 'dodatek-1.pdf', note: 'Inflační doložka.' });
    await addContractUtility(db, orgId, c1.id, all, { kind: 'electricity', validFrom: day(lastY, 1, 1), monthlyAdvance: Kc(1300) });
    await addContractTerms(db, orgId, c1.id, all, { validFrom: day(thisY, 1, 1), baseRent: Kc(15000), serviceAdvance: Kc(3300), paymentDueDay: 10, source: 'addendum', documentRef: 'dodatek-2.pdf' });
    await addContractUtility(db, orgId, c1.id, all, { kind: 'electricity', validFrom: day(thisY, 1, 1), monthlyAdvance: Kc(1500) });

    const c1Total = (y: number) => y < lastY ? 17700 : y === lastY ? 18400 : 19800;
    for (const [y, m] of monthsUntilNow(ym(lastY - 1, 2))) {
      const isCurrent = y === thisY && m === thisM;
      const reduced = y === thisY && m === 3; // srážka za opravu kotle
      if (reduced) await addRentReduction(db, orgId, c1.id, all, { forMonth: day(y, m, 1), amount: Kc(2000), reason: 'oprava kotle hrazená nájemníkem' });
      const amount = isCurrent ? 7800 : c1Total(y) - (reduced ? 2000 : 0) + (y === thisY && m === 4 ? 2000 : 0);
      const paidDay = isCurrent ? Math.min(27, now.getDate()) : (m % 5 === 0 ? 14 : 8);
      await recordPayment(db, orgId, all, { contractId: c1.id, amount: Kc(amount), paidAt: day(y, m, paidDay), counterparty: 'Petra Svobodová', counterpartyAccount: '1234567890/0800', vs: '1001', source: 'bank', externalId: `KB-${y}${String(m).padStart(2, '0')}-1001` });
    }
    for (const y of [lastY - 1, lastY]) {
      await createCostStatement(db, orgId, all, { propertyId: lipova.id, kind: 'services', periodFrom: day(y, 1, 1), periodTo: day(y, 12, 31), totalAmount: Kc(y === lastY ? 52400 : 48900), adjustmentAmount: -Kc(y === lastY ? 14400 : 13200), adjustmentNote: 'fond oprav a odměny výboru nese pronajímatel', documentRef: `vyuctovani-svj-${y}.pdf` });
      await createCostStatement(db, orgId, all, { propertyId: lipova.id, kind: 'electricity', periodFrom: day(y, 1, 1), periodTo: day(y, 12, 31), totalAmount: Kc(y === lastY ? 16100 : 13900), documentRef: `vyuctovani-elektrina-${y}.pdf` });
    }
    const r1 = await computeReconciliation(db, orgId, c1.id, all, { periodFrom: day(lastY - 1, 1, 1), periodTo: day(lastY - 1, 12, 31) });
    await finalizeReconciliation(db, orgId, r1.id, all);
    await computeReconciliation(db, orgId, c1.id, all, { periodFrom: day(lastY, 1, 1), periodTo: day(lastY, 12, 31) });

    // ── Contract 2: Tomáš, Nádražní, two months behind ────────────────────
    const c2 = await createContract(db, orgId, all, { propertyId: nadrazni.id, tenantId: tomas.id, startDate: day(lastY, 1, 1), endDate: day(thisY, 12, 31), securityDeposit: Kc(22000) });
    await addContractTerms(db, orgId, c2.id, all, { validFrom: day(lastY, 1, 1), baseRent: Kc(9500), serviceAdvance: Kc(2600), paymentDueDay: 15, paymentAppliesTo: 'next', source: 'initial' });
    await addContractUtility(db, orgId, c2.id, all, { kind: 'electricity', validFrom: day(lastY, 1, 1), monthlyAdvance: Kc(900) });
    await addContractUtility(db, orgId, c2.id, all, { kind: 'internet', validFrom: day(lastY, 1, 1), monthlyAdvance: Kc(400) });
    const c2Months = monthsUntilNow(ym(lastY, 1));
    for (const [i, [y, m]] of c2Months.entries()) {
      if (i >= c2Months.length - 2) continue; // last two months unpaid
      await recordPayment(db, orgId, all, { contractId: c2.id, amount: Kc(13400), paidAt: day(y, m, 12), counterparty: 'Tomáš Dvořák', counterpartyAccount: '2345678901/0100', vs: '1002', source: 'bank', externalId: `KB-${y}${String(m).padStart(2, '0')}-1002` });
    }
    await createCostStatement(db, orgId, all, { propertyId: nadrazni.id, kind: 'services', periodFrom: day(lastY, 1, 1), periodTo: day(lastY, 12, 31), totalAmount: Kc(29800), adjustmentAmount: -Kc(7200), adjustmentNote: 'fond oprav nese pronajímatel' });

    // ── Contract 3: Lucie, Školní, running, paid by hand ──────────────────
    const c3 = await createContract(db, orgId, all, { propertyId: skolni.id, tenantId: lucie.id, startDate: day(thisY, 3, 1), securityDeposit: Kc(24000) });
    await addContractTerms(db, orgId, c3.id, all, { validFrom: day(thisY, 3, 1), baseRent: Kc(11800), serviceAdvance: Kc(2200), paymentDueDay: 5, source: 'initial' });
    for (const [y, m] of monthsUntilNow(ym(thisY, 3))) {
      await recordPayment(db, orgId, all, { contractId: c3.id, amount: Kc(14000), paidAt: day(y, m, Math.min(3, now.getDate())), counterparty: 'Lucie Veselá', source: 'manual' });
    }

    // ── Contract 4: Jan, Školní, ended last year ──────────────────────────
    const c4 = await createContract(db, orgId, all, { propertyId: skolni.id, tenantId: jan.id, startDate: day(lastY - 1, 6, 1), endDate: day(lastY, 12, 31), securityDeposit: Kc(20000) });
    await addContractTerms(db, orgId, c4.id, all, { validFrom: day(lastY - 1, 6, 1), baseRent: Kc(10500), serviceAdvance: Kc(2000), paymentDueDay: 20, source: 'initial' });
    for (const [y, m] of monthsUntilNow(ym(lastY - 1, 6)).filter(([y]) => y <= lastY)) {
      await recordPayment(db, orgId, all, { contractId: c4.id, amount: Kc(12500), paidAt: day(y, m, 18), counterparty: 'Jan Novotný', counterpartyAccount: '4567890123/0600', vs: '1004', source: 'bank', externalId: `KB-${y}${String(m).padStart(2, '0')}-1004` });
    }

    // ── Two bank payments nobody has assigned yet ─────────────────────────
    await recordPayment(db, orgId, all, { amount: Kc(11200), paidAt: day(thisY, thisM, Math.max(1, now.getDate() - 3)), counterparty: 'NOVAK JIRI', counterpartyAccount: '9876543210/2010', vs: '2810', source: 'bank', externalId: 'KB-unassigned-1' });
    await recordPayment(db, orgId, all, { amount: Kc(5000), paidAt: day(thisY, thisM, Math.max(1, now.getDate() - 1)), counterparty: 'Petra Svobodová', counterpartyAccount: '1234567890/0800', vs: '1001', ss: '2026', source: 'bank', externalId: 'KB-unassigned-2', description: 'doplatek vyúčtování' });

    console.log(JSON.stringify({ email: EMAIL, orgId, contracts: [c1.id, c2.id, c3.id, c4.id] }, null, 2));
  } finally {
    await close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
