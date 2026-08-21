import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { RentalApiClient } from '../client.js';

const Haler = z.number().int();

const Empty = z.object({});

const IntegrationId = z.object({ id: z.string().describe('Bank integration ID') });

const ListTransactionsInput = z.object({
  status: z.enum(['unmatched', 'matched', 'ambiguous', 'suspected_duplicate', 'ignored', 'parse_failed']).optional()
    .describe('Filter by pairing status'),
  pending: z.boolean().optional()
    .describe('Only transactions still waiting for a payment (paymentId is null and not ignored)'),
});

const AssignTransactionInput = z.object({
  id: z.string().describe('Bank transaction ID'),
  contractId: z.string().describe('Contract to pair the transaction with; creates the payment'),
});

const TransactionId = z.object({ id: z.string().describe('Bank transaction ID') });

const ContractIdInput = z.object({ contractId: z.string().describe('Contract ID') });

const SetRuleInput = z.object({
  contractId: z.string().describe('Contract ID'),
  counterpartyAccount: z.string().nullable().optional()
    .describe("Payer's account, e.g. '294153028/0300'. null = any. The prefix is significant: '123-294153028/0300' is a different account."),
  vs: z.string().nullable().optional().describe('Variabilní symbol; null = any'),
  ks: z.string().nullable().optional().describe('Konstantní symbol; null = any'),
  ss: z.string().nullable().optional().describe('Specifický symbol; null = any'),
  amountFrom: Haler.nullable().optional().describe('Inclusive lower bound in haléře (CZK × 100); null = no lower bound'),
  amountTo: Haler.nullable().optional().describe('Inclusive upper bound in haléře (CZK × 100); null = no upper bound'),
  active: z.boolean().optional(),
});

export async function bankIntegrationsList(client: RentalApiClient, _args: z.infer<typeof Empty>) {
  const data = await client.get<{ bankIntegrations: unknown[] }>('/api/bank-integrations');
  return data.bankIntegrations;
}

export async function bankIntegrationsSetupUrl(client: RentalApiClient, _args: z.infer<typeof Empty>) {
  return {
    url: `${client.baseUrl.replace(/\/$/, '')}/settings?tab=bank&action=new`,
    note: 'Open this and fill in the IMAP details. Gmail needs an App Password (requires 2FA), not the account password.',
  };
}

export async function bankIntegrationsSync(client: RentalApiClient, args: z.infer<typeof IntegrationId>) {
  const data = await client.post<{ result: unknown }>(`/api/bank-integrations/${args.id}/sync`, {});
  return data.result;
}

export async function bankTransactionsList(client: RentalApiClient, args: z.infer<typeof ListTransactionsInput>) {
  const qs = new URLSearchParams();
  if (args.status) qs.set('status', args.status);
  if (args.pending) qs.set('pending', '1');
  const suffix = qs.toString() ? `?${qs}` : '';
  const data = await client.get<{ bankTransactions: unknown[] }>(`/api/bank-transactions${suffix}`);
  return data.bankTransactions;
}

export async function bankTransactionsAssign(client: RentalApiClient, args: z.infer<typeof AssignTransactionInput>) {
  const data = await client.post<{ bankTransaction: unknown }>(`/api/bank-transactions/${args.id}/assign`, { contractId: args.contractId });
  return data.bankTransaction;
}

export async function bankTransactionsIgnore(client: RentalApiClient, args: z.infer<typeof TransactionId>) {
  const data = await client.post<{ bankTransaction: unknown }>(`/api/bank-transactions/${args.id}/ignore`, {});
  return data.bankTransaction;
}

export async function paymentRuleGet(client: RentalApiClient, args: z.infer<typeof ContractIdInput>) {
  return client.get<unknown>(`/api/contracts/${args.contractId}/payment-rule`);
}

export async function paymentRuleSet(client: RentalApiClient, args: z.infer<typeof SetRuleInput>) {
  const { contractId, ...body } = args;
  const data = await client.put<{ rule: unknown }>(`/api/contracts/${contractId}/payment-rule`, body);
  return data.rule;
}

export function addBankTools(server: FastMCP, client: RentalApiClient) {
  server.addTool({
    name: 'bank_integrations_list',
    description: "List the org's bank integrations (IMAP mailboxes harvested for incoming-payment notifications), including each one's last sync status. Never returns credentials.",
    parameters: Empty,
    execute: async (args) => JSON.stringify(await bankIntegrationsList(client, args), null, 2),
  });

  server.addTool({
    name: 'bank_integrations_setup_url',
    description: 'Get a link the user can open to add a new bank integration in the web app. Use this when asked to add or connect a bank/mailbox: creating one requires an IMAP password, which must be typed into the app directly rather than passed through a tool call.',
    parameters: Empty,
    execute: async (args) => JSON.stringify(await bankIntegrationsSetupUrl(client, args), null, 2),
  });

  server.addTool({
    name: 'bank_integrations_sync',
    description: "Run an integration's IMAP sync now instead of waiting for the daily cron. Returns counters: fetched, created, matched, failed.",
    parameters: IntegrationId,
    execute: async (args) => JSON.stringify(await bankIntegrationsSync(client, args), null, 2),
  });

  server.addTool({
    name: 'bank_transactions_list',
    description: 'List parsed incoming bank transactions. Use pending:true to see only those still needing attention — unmatched, ambiguous, suspected duplicates, and parse failures.',
    parameters: ListTransactionsInput,
    execute: async (args) => JSON.stringify(await bankTransactionsList(client, args), null, 2),
  });

  server.addTool({
    name: 'bank_transactions_assign',
    description: 'Pair a bank transaction to a contract, creating the payment. Also the way to confirm a suspected_duplicate is genuinely a separate payment.',
    parameters: AssignTransactionInput,
    execute: async (args) => JSON.stringify(await bankTransactionsAssign(client, args), null, 2),
  });

  server.addTool({
    name: 'bank_transactions_ignore',
    description: 'Mark a bank transaction as not relevant (bank noise, a refund, an unrelated transfer). Creates no payment and removes it from the pending list.',
    parameters: TransactionId,
    execute: async (args) => JSON.stringify(await bankTransactionsIgnore(client, args), null, 2),
  });

  server.addTool({
    name: 'payment_rule_get',
    description: "Read a contract's payment-pairing rule plus the derived pairing health (nenastaveno / ok / chyba).",
    parameters: ContractIdInput,
    execute: async (args) => JSON.stringify(await paymentRuleGet(client, args), null, 2),
  });

  server.addTool({
    name: 'payment_rule_set',
    description: 'Create or replace a contract\'s payment-pairing rule. PUT semantics: omitted criteria become null ("any"), they are NOT merged with the existing rule. A rule must have at least one criterion.',
    parameters: SetRuleInput,
    execute: async (args) => JSON.stringify(await paymentRuleSet(client, args), null, 2),
  });
}
