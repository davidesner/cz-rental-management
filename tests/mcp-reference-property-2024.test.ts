import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';
import { RentalApiClient } from '../mcp/client.js';
import { createProperty } from '../mcp/tools/properties.js';
import { createTenant } from '../mcp/tools/tenants.js';
import { createContract } from '../mcp/tools/contracts.js';
import { addContractTerms } from '../mcp/tools/contract-terms.js';
import { addContractUtility } from '../mcp/tools/contract-utilities.js';
import { addPropertyTariff } from '../mcp/tools/property-tariffs.js';
import { recordPaymentsBatch } from '../mcp/tools/payments.js';
import { createCostStatement } from '../mcp/tools/cost-statements.js';
import { computeReconciliation } from '../mcp/tools/reconciliations.js';

describe('<property-name-a> 2024 — MCP replay', () => {
  it('produces +693 Kč via MCP tools', async () => {
    const { db, client: dbClient } = await freshDb();
    const app = makeApp(db);
    const { cookie } = await registerUser(app, 'esnerda@gmail.com', 'password123', 'David');
    await app.request('/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'David rentals' }),
    });
    const tokRes = await app.request('/api/api-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'mcp' }),
    });
    const { token } = (await tokRes.json()) as { token: string };
    const client = new RentalApiClient(
      'http://test',
      token,
      ((url: string, init?: RequestInit) =>
        app.request(url.replace('http://test', ''), init)) as unknown as typeof fetch,
    );

    const property = await createProperty(client, {
      name: '<property-name-a>',
      address: 'Praha',
      reconciliationSkill: 'reference-reconciliation',
      note: null,
    });

    const tenant = await createTenant(client, {
      name: '<tenant-name>',
      accountNumber: '294153028/0300',
      email: null,
      phone: null,
      note: null,
    });

    const contract = await createContract(client, {
      propertyId: property.id,
      tenantId: (tenant as { id: string }).id,
      startDate: '2024-09-20',
      endDate: null,
      securityDeposit: 6600000,
      note: null,
    });

    await addContractTerms(client, {
      contractId: (contract as { id: string }).id,
      validFrom: '2024-09-20',
      baseRent: 3300000,
      serviceAdvance: 700000,
      source: 'initial',
      note: null,
    });

    await addContractUtility(client, {
      contractId: (contract as { id: string }).id,
      kind: 'electricity',
      validFrom: '2024-09-20',
      monthlyAdvance: 120000,
      note: null,
    });

    await addPropertyTariff(client, {
      propertyId: property.id,
      validFrom: '2023-11-01',
      totalSvjAdvance: 888400,
      deductibleAmount: 187800,
      deductibleNote: 'Fond oprav + ...',
      note: null,
    });

    await recordPaymentsBatch(client, {
      payments: [
        {
          contractId: (contract as { id: string }).id,
          amount: 1510700,
          paidAt: '2024-09-20',
          source: 'manual',
          externalId: 'kp-2024-09',
          counterparty: 'BOHUS STEFAN',
          counterpartyAccount: null,
          statementRef: null,
          description: null,
          note: null,
        },
        {
          contractId: (contract as { id: string }).id,
          amount: 4120000,
          paidAt: '2024-10-10',
          source: 'bank',
          externalId: 'kp-2024-10',
          counterparty: 'BOHUS STEFAN',
          counterpartyAccount: null,
          statementRef: null,
          description: null,
          note: null,
        },
        {
          contractId: (contract as { id: string }).id,
          amount: 4120000,
          paidAt: '2024-11-10',
          source: 'bank',
          externalId: 'kp-2024-11',
          counterparty: 'BOHUS STEFAN',
          counterpartyAccount: null,
          statementRef: null,
          description: null,
          note: null,
        },
        {
          contractId: (contract as { id: string }).id,
          amount: 4120000,
          paidAt: '2024-12-10',
          source: 'bank',
          externalId: 'kp-2024-12',
          counterparty: 'BOHUS STEFAN',
          counterpartyAccount: null,
          statementRef: null,
          description: null,
          note: null,
        },
      ],
    });

    await createCostStatement(client, {
      propertyId: property.id,
      kind: 'services',
      periodFrom: '2024-09-20',
      periodTo: '2024-12-31',
      totalAmount: 2999949,
      adjustmentAmount: -625374,
      adjustmentNote: 'FO portion',
      documentRef: 'svj-2024.pdf',
      issuedAt: null,
      note: null,
    });

    await createCostStatement(client, {
      propertyId: property.id,
      kind: 'electricity',
      periodFrom: '2024-09-20',
      periodTo: '2024-12-31',
      totalAmount: 316867,
      adjustmentAmount: 0,
      adjustmentNote: null,
      documentRef: null,
      issuedAt: null,
      note: null,
    });

    const rec = await computeReconciliation(client, {
      contractId: (contract as { id: string }).id,
      periodFrom: '2024-09-20',
      periodTo: '2024-12-31',
      note: null,
    });

    const total = rec.items.reduce((s: number, it: { difference: number }) => s + it.difference, 0);

    // Print breakdown for debugging
    console.log('<property-name-a> 2024 MCP reconciliation breakdown:');
    for (const it of rec.items) {
      console.log(
        `  ${(it as { kind: string }).kind}: paid ${((it as { paid: number }).paid / 100).toFixed(2)} Kč, cost ${((it as { actualCost: number }).actualCost / 100).toFixed(2)} Kč, diff ${(it.difference / 100).toFixed(2)} Kč`,
      );
    }
    console.log(`  TOTAL: ${(total / 100).toFixed(2)} Kč`);

    // Expected ~+69,258 haléře (+692.58 Kč), tolerance ±100 haléře (±1 Kč)
    expect(total).toBeGreaterThanOrEqual(69200);
    expect(total).toBeLessThanOrEqual(69400);

    await dbClient.close();
  }, 30000);
});
