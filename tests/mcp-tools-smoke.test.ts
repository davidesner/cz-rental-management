import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';
import { RentalApiClient } from '../mcp/client.js';
import { listProperties, createProperty, getProperty, updateProperty } from '../mcp/tools/properties.js';
import { listTenants, createTenant } from '../mcp/tools/tenants.js';
import { listContracts, createContract } from '../mcp/tools/contracts.js';
import { listContractTerms, addContractTerms } from '../mcp/tools/contract-terms.js';
import { listContractUtilities, addContractUtility } from '../mcp/tools/contract-utilities.js';
import { listPropertyTariffs, addPropertyTariff } from '../mcp/tools/property-tariffs.js';
import { listPayments, recordPayment, recordPaymentsBatch, deletePayment } from '../mcp/tools/payments.js';
import { listCostStatements, createCostStatement, deleteCostStatement } from '../mcp/tools/cost-statements.js';
import { listReconciliations, computeReconciliation } from '../mcp/tools/reconciliations.js';
import { listOrganizations, createOrganization } from '../mcp/tools/organizations.js';
import { getMe } from '../mcp/tools/me.js';
import { addRentReduction, listRentReductions, deleteRentReduction } from '../mcp/tools/rent-reductions.js';
import { paymentBreakdown } from '../mcp/tools/payment-breakdown.js';

async function bootstrap() {
  const { db, client: dbClient } = await freshDb();
  const app = makeApp(db);
  const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
  await app.request('/api/organizations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'O' }),
  });
  const tokRes = await app.request('/api/api-tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'test' }),
  });
  const { token } = (await tokRes.json()) as { token: string };

  // Use the Hono app.fetch as fetchImpl — client doesn't care if it's a real HTTP fetch
  const mcpClient = new RentalApiClient(
    'http://test',
    token,
    ((url: string, init?: RequestInit) =>
      app.request(url.replace('http://test', ''), init)) as unknown as typeof fetch,
  );
  return { dbClient, mcpClient, cookie, app };
}

describe('MCP tools smoke', () => {
  it('me_get returns user and memberships', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const me = await getMe(mcpClient, {});
    expect(me).toMatchObject({ user: { email: 'a@b.cz' } });
    await dbClient.close();
  });

  it('organizations_list and organizations_create round-trip', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const initial = await listOrganizations(mcpClient, {});
    // Already has 'O' from bootstrap
    expect(Array.isArray(initial)).toBe(true);
    const org = await createOrganization(mcpClient, { name: 'New Org' });
    expect((org as { name: string }).name).toBe('New Org');
    await dbClient.close();
  });

  it('properties_create then properties_list returns it', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const created = await createProperty(mcpClient, {
      name: '<property-name-a>',
      address: null,
      reconciliationSkill: 'reference-reconciliation',
      note: null,
    });
    expect(created.name).toBe('<property-name-a>');
    const list = await listProperties(mcpClient, {});
    expect(list).toHaveLength(1);
    await dbClient.close();
  });

  it('properties_get returns single property', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const created = await createProperty(mcpClient, { name: 'Test Property', address: 'Praha 1', reconciliationSkill: null, note: null });
    const found = await getProperty(mcpClient, { id: created.id });
    expect((found as { name: string }).name).toBe('Test Property');
    await dbClient.close();
  });

  it('properties_update updates name', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const created = await createProperty(mcpClient, { name: 'Old Name', address: null, reconciliationSkill: null, note: null });
    const updated = await updateProperty(mcpClient, { id: created.id, name: 'New Name' });
    expect((updated as { name: string }).name).toBe('New Name');
    await dbClient.close();
  });

  it('tenants_create and tenants_list round-trip', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const tenant = await createTenant(mcpClient, { name: 'Jan Novak', email: null, phone: null, accountNumber: '123/0100', note: null });
    expect((tenant as { name: string }).name).toBe('Jan Novak');
    const list = await listTenants(mcpClient, {});
    expect(list).toHaveLength(1);
    await dbClient.close();
  });

  it('contracts_create and contracts_list round-trip', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const prop = await createProperty(mcpClient, { name: 'P', address: null, reconciliationSkill: null, note: null });
    const tenant = await createTenant(mcpClient, { name: 'T', email: null, phone: null, accountNumber: null, note: null });
    const contract = await createContract(mcpClient, { propertyId: prop.id, tenantId: (tenant as { id: string }).id, startDate: '2024-01-01', endDate: null, securityDeposit: null, note: null });
    expect((contract as { id: string }).id).toBeTruthy();
    const list = await listContracts(mcpClient, {});
    expect(list).toHaveLength(1);
    await dbClient.close();
  });

  it('contract_terms_add and list round-trip', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const prop = await createProperty(mcpClient, { name: 'P', address: null, reconciliationSkill: null, note: null });
    const tenant = await createTenant(mcpClient, { name: 'T', email: null, phone: null, accountNumber: null, note: null });
    const contract = await createContract(mcpClient, { propertyId: prop.id, tenantId: (tenant as { id: string }).id, startDate: '2024-01-01', endDate: null, securityDeposit: null, note: null });
    const contractId = (contract as { id: string }).id;
    await addContractTerms(mcpClient, { contractId, validFrom: '2024-01-01', baseRent: 3300000, serviceAdvance: 700000, source: 'initial', note: null });
    const terms = await listContractTerms(mcpClient, { contractId });
    expect(terms).toHaveLength(1);
    await dbClient.close();
  });

  it('contract_utilities_add and list round-trip', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const prop = await createProperty(mcpClient, { name: 'P', address: null, reconciliationSkill: null, note: null });
    const tenant = await createTenant(mcpClient, { name: 'T', email: null, phone: null, accountNumber: null, note: null });
    const contract = await createContract(mcpClient, { propertyId: prop.id, tenantId: (tenant as { id: string }).id, startDate: '2024-01-01', endDate: null, securityDeposit: null, note: null });
    const contractId = (contract as { id: string }).id;
    await addContractUtility(mcpClient, { contractId, kind: 'electricity', validFrom: '2024-01-01', monthlyAdvance: 120000, note: null });
    const utils = await listContractUtilities(mcpClient, { contractId });
    expect(utils).toHaveLength(1);
    await dbClient.close();
  });

  it('property_tariffs_add and list round-trip', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const prop = await createProperty(mcpClient, { name: 'P', address: null, reconciliationSkill: null, note: null });
    const propertyId = prop.id;
    await addPropertyTariff(mcpClient, { propertyId, validFrom: '2024-01-01', totalSvjAdvance: 888400, deductibleAmount: 187800, deductibleNote: 'Fond oprav', note: null });
    const tariffs = await listPropertyTariffs(mcpClient, { propertyId });
    expect(tariffs).toHaveLength(1);
    await dbClient.close();
  });

  it('payments_record and payments_list round-trip', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const prop = await createProperty(mcpClient, { name: 'P', address: null, reconciliationSkill: null, note: null });
    const tenant = await createTenant(mcpClient, { name: 'T', email: null, phone: null, accountNumber: null, note: null });
    const contract = await createContract(mcpClient, { propertyId: prop.id, tenantId: (tenant as { id: string }).id, startDate: '2024-01-01', endDate: null, securityDeposit: null, note: null });
    const contractId = (contract as { id: string }).id;
    await addContractTerms(mcpClient, { contractId, validFrom: '2024-01-01', baseRent: 1000000, serviceAdvance: 100000, source: 'initial', note: null });
    const payment = await recordPayment(mcpClient, { contractId, amount: 1100000, paidAt: '2024-01-10', source: 'bank', externalId: 'test-01', counterparty: null, counterpartyAccount: null, statementRef: null, description: null, note: null });
    expect((payment as { amount: number }).amount).toBe(1100000);
    const list = await listPayments(mcpClient, { contractId });
    expect(list).toHaveLength(1);
    await dbClient.close();
  });

  it('payments_record_batch returns created/existing', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const prop = await createProperty(mcpClient, { name: 'P', address: null, reconciliationSkill: null, note: null });
    const tenant = await createTenant(mcpClient, { name: 'T', email: null, phone: null, accountNumber: null, note: null });
    const contract = await createContract(mcpClient, { propertyId: prop.id, tenantId: (tenant as { id: string }).id, startDate: '2024-01-01', endDate: null, securityDeposit: null, note: null });
    const contractId = (contract as { id: string }).id;
    await addContractTerms(mcpClient, { contractId, validFrom: '2024-01-01', baseRent: 1000000, serviceAdvance: 100000, source: 'initial', note: null });
    const result1 = await recordPaymentsBatch(mcpClient, {
      payments: [
        { contractId, amount: 1100000, paidAt: '2024-01-10', source: 'bank', externalId: 'batch-01', counterparty: null, counterpartyAccount: null, statementRef: null, description: null, note: null },
      ],
    });
    expect(result1.created).toHaveLength(1);
    // Re-import: should be idempotent
    const result2 = await recordPaymentsBatch(mcpClient, {
      payments: [
        { contractId, amount: 1100000, paidAt: '2024-01-10', source: 'bank', externalId: 'batch-01', counterparty: null, counterpartyAccount: null, statementRef: null, description: null, note: null },
      ],
    });
    expect(result2.existing).toHaveLength(1);
    await dbClient.close();
  });

  it('payments_delete removes payment', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const prop = await createProperty(mcpClient, { name: 'P', address: null, reconciliationSkill: null, note: null });
    const tenant = await createTenant(mcpClient, { name: 'T', email: null, phone: null, accountNumber: null, note: null });
    const contract = await createContract(mcpClient, { propertyId: prop.id, tenantId: (tenant as { id: string }).id, startDate: '2024-01-01', endDate: null, securityDeposit: null, note: null });
    const contractId = (contract as { id: string }).id;
    await addContractTerms(mcpClient, { contractId, validFrom: '2024-01-01', baseRent: 1000000, serviceAdvance: 100000, source: 'initial', note: null });
    const payment = await recordPayment(mcpClient, { contractId, amount: 1000000, paidAt: '2024-01-10', source: 'bank', externalId: null, counterparty: null, counterpartyAccount: null, statementRef: null, description: null, note: null });
    await deletePayment(mcpClient, { id: (payment as { id: string }).id });
    const list = await listPayments(mcpClient, { contractId });
    expect(list).toHaveLength(0);
    await dbClient.close();
  });

  it('cost_statements_create and list round-trip', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const prop = await createProperty(mcpClient, { name: 'P', address: null, reconciliationSkill: null, note: null });
    const propertyId = prop.id;
    const stmt = await createCostStatement(mcpClient, {
      propertyId,
      kind: 'electricity',
      periodFrom: '2024-01-01',
      periodTo: '2024-12-31',
      totalAmount: 300000,
      adjustmentAmount: 0,
      adjustmentNote: null,
      documentRef: null,
      issuedAt: null,
      note: null,
    });
    expect(stmt.id).toBeTruthy();
    const list = await listCostStatements(mcpClient, { propertyId });
    expect(list).toHaveLength(1);
    await dbClient.close();
  });

  it('cost_statements_delete removes statement', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const prop = await createProperty(mcpClient, { name: 'P', address: null, reconciliationSkill: null, note: null });
    const stmt = await createCostStatement(mcpClient, {
      propertyId: prop.id,
      kind: 'services',
      periodFrom: '2024-01-01',
      periodTo: '2024-12-31',
      totalAmount: 100000,
      adjustmentAmount: 0,
      adjustmentNote: null,
      documentRef: null,
      issuedAt: null,
      note: null,
    });
    await deleteCostStatement(mcpClient, { id: stmt.id });
    const list = await listCostStatements(mcpClient, { propertyId: prop.id });
    expect(list).toHaveLength(0);
    await dbClient.close();
  });

  it('reconciliations_compute and list round-trip', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const prop = await createProperty(mcpClient, { name: 'P', address: null, reconciliationSkill: null, note: null });
    const tenant = await createTenant(mcpClient, { name: 'T', email: null, phone: null, accountNumber: null, note: null });
    const contract = await createContract(mcpClient, { propertyId: prop.id, tenantId: (tenant as { id: string }).id, startDate: '2024-01-01', endDate: null, securityDeposit: null, note: null });
    const contractId = (contract as { id: string }).id;
    await addContractTerms(mcpClient, { contractId, validFrom: '2024-01-01', baseRent: 1000000, serviceAdvance: 100000, source: 'initial', note: null });
    await addContractUtility(mcpClient, { contractId, kind: 'electricity', validFrom: '2024-01-01', monthlyAdvance: 50000, note: null });
    await recordPaymentsBatch(mcpClient, {
      payments: [
        { contractId, amount: 1150000, paidAt: '2024-01-10', source: 'bank', externalId: 'r-01', counterparty: null, counterpartyAccount: null, statementRef: null, description: null, note: null },
      ],
    });
    await createCostStatement(mcpClient, {
      propertyId: prop.id,
      kind: 'electricity',
      periodFrom: '2024-01-01',
      periodTo: '2024-01-31',
      totalAmount: 40000,
      adjustmentAmount: 0,
      adjustmentNote: null,
      documentRef: null,
      issuedAt: null,
      note: null,
    });
    const rec = await computeReconciliation(mcpClient, { contractId, periodFrom: '2024-01-01', periodTo: '2024-01-31', note: null });
    expect(rec.id).toBeTruthy();
    expect(rec.items).toBeDefined();
    const recs = await listReconciliations(mcpClient, { contractId });
    expect(recs).toHaveLength(1);
    await dbClient.close();
  });

  it('rent_reductions_add, list, and delete round-trip', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const prop = await createProperty(mcpClient, { name: 'P', address: null, reconciliationSkill: null, note: null });
    const tenant = await createTenant(mcpClient, { name: 'T', email: null, phone: null, accountNumber: null, note: null });
    const contract = await createContract(mcpClient, { propertyId: prop.id, tenantId: (tenant as { id: string }).id, startDate: '2024-01-01', endDate: null, securityDeposit: null, note: null });
    const contractId = (contract as { id: string }).id;

    // Add a rent reduction
    const reduction = await addRentReduction(mcpClient, {
      contractId,
      forMonth: '2024-11-01',
      amount: 50000,
      reason: 'Tenant fixed leaky pipe',
    });
    expect((reduction as { forMonth: string; amount: number }).forMonth).toBe('2024-11-01');
    expect((reduction as { forMonth: string; amount: number }).amount).toBe(50000);

    // List should include it
    const reductions = await listRentReductions(mcpClient, { contractId });
    expect(reductions).toHaveLength(1);

    // Delete it
    const id = (reduction as { id: string }).id;
    await deleteRentReduction(mcpClient, { contractId, id });

    // List should be empty
    const reductionsAfterDelete = await listRentReductions(mcpClient, { contractId });
    expect(reductionsAfterDelete).toHaveLength(0);

    await dbClient.close();
  });

  it('contracts_payment_breakdown returns months with rent reduction applied', async () => {
    const { dbClient, mcpClient } = await bootstrap();
    const prop = await createProperty(mcpClient, { name: 'P', address: null, reconciliationSkill: null, note: null });
    const tenant = await createTenant(mcpClient, { name: 'T', email: null, phone: null, accountNumber: null, note: null });
    const contract = await createContract(mcpClient, { propertyId: prop.id, tenantId: (tenant as { id: string }).id, startDate: '2024-11-01', endDate: null, securityDeposit: null, note: null });
    const contractId = (contract as { id: string }).id;

    // Add terms and utilities
    await addContractTerms(mcpClient, { contractId, validFrom: '2024-11-01', baseRent: 1000000, serviceAdvance: 100000, source: 'initial', note: null });
    await addContractUtility(mcpClient, { contractId, kind: 'electricity', validFrom: '2024-11-01', monthlyAdvance: 50000, note: null });

    // Add a rent reduction for November
    await addRentReduction(mcpClient, { contractId, forMonth: '2024-11-01', amount: 200000, reason: 'Tenant repair credit' });

    // Get payment breakdown for November
    const breakdown = await paymentBreakdown(mcpClient, { contractId, from: '2024-11-01', to: '2024-11-30' });
    expect((breakdown as any).months).toHaveLength(1);
    expect((breakdown as any).months[0].rentReduction).toBe(200000);
    expect((breakdown as any).months[0].expected.total).toBe(1150000); // rent + service + utilities
    expect((breakdown as any).months[0].effectiveExpected).toBe(950000); // after reduction
    expect((breakdown as any).rentReductions).toHaveLength(1);

    await dbClient.close();
  });
});
