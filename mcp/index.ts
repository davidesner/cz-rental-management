#!/usr/bin/env tsx
import 'dotenv/config';
import { FastMCP } from 'fastmcp';
import { RentalApiClient } from './client.js';
import { addMeTools } from './tools/me.js';
import { addOrganizationTools } from './tools/organizations.js';
import { addPropertyTools } from './tools/properties.js';
import { addTenantTools } from './tools/tenants.js';
import { addContractTools } from './tools/contracts.js';
import { addContractTermsTools } from './tools/contract-terms.js';
import { addContractUtilityTools } from './tools/contract-utilities.js';
import { addPropertyTariffTools } from './tools/property-tariffs.js';
import { addPaymentTools } from './tools/payments.js';
import { addCostStatementTools } from './tools/cost-statements.js';
import { addReconciliationTools } from './tools/reconciliations.js';
import { addRentReductionTools } from './tools/rent-reductions.js';
import { addPaymentBreakdownTools } from './tools/payment-breakdown.js';

const apiUrl = process.env['RENTAL_API_URL'] ?? 'http://localhost:3000';
const apiToken = process.env['RENTAL_API_TOKEN'];
if (!apiToken) {
  console.error('RENTAL_API_TOKEN is required');
  process.exit(1);
}

const client = new RentalApiClient(apiUrl, apiToken);
const server = new FastMCP({
  name: 'rental-management',
  version: '0.1.0',
});

addMeTools(server, client);
addOrganizationTools(server, client);
addPropertyTools(server, client);
addTenantTools(server, client);
addContractTools(server, client);
addContractTermsTools(server, client);
addContractUtilityTools(server, client);
addPropertyTariffTools(server, client);
addPaymentTools(server, client);
addCostStatementTools(server, client);
addReconciliationTools(server, client);
addRentReductionTools(server, client);
addPaymentBreakdownTools(server, client);

server.start({ transportType: 'stdio' });
