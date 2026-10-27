import type { RentalApiClient } from '../client.js';
import { addMeTools } from './me.js';
import { addOrganizationTools } from './organizations.js';
import { addPropertyTools } from './properties.js';
import { addTenantTools } from './tenants.js';
import { addContractTools } from './contracts.js';
import { addContractTermsTools } from './contract-terms.js';
import { addContractUtilityTools } from './contract-utilities.js';
import { addPropertyTariffTools } from './property-tariffs.js';
import { addPaymentTools } from './payments.js';
import { addCostStatementTools } from './cost-statements.js';
import { addReconciliationTools } from './reconciliations.js';
import { addRentReductionTools } from './rent-reductions.js';
import { addPaymentBreakdownTools } from './payment-breakdown.js';
import { addBankTools } from './bank.js';
import type { ToolSink } from './sink.js';

/** Every tool, in one place for both the stdio server and the remote `/mcp` endpoint. */
export function addAllTools(sink: ToolSink, client: RentalApiClient): void {
  addMeTools(sink, client);
  addOrganizationTools(sink, client);
  addPropertyTools(sink, client);
  addTenantTools(sink, client);
  addContractTools(sink, client);
  addContractTermsTools(sink, client);
  addContractUtilityTools(sink, client);
  addPropertyTariffTools(sink, client);
  addPaymentTools(sink, client);
  addCostStatementTools(sink, client);
  addReconciliationTools(sink, client);
  addRentReductionTools(sink, client);
  addPaymentBreakdownTools(sink, client);
  addBankTools(sink, client);
}
