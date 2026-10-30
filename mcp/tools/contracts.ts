import { z } from 'zod';
import type { ToolSink } from './sink.js';
import type { RentalApiClient } from '../client.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ListContractsInput = z.object({});

const GetContractInput = z.object({
  id: z.string().describe('Contract ID'),
});

const CreateContractInput = z.object({
  propertyId: z.string().describe('Property ID'),
  tenantId: z.string().describe('Tenant ID'),
  startDate: DateStr.describe('Contract start date (YYYY-MM-DD)'),
  endDate: DateStr.nullable().optional().describe('Contract end date (YYYY-MM-DD), null if open-ended. For an auto-renewing contract this is the ORIGINAL end of the fixed term.'),
  autoRenew: z.boolean().optional().describe('Contract renews automatically on the same terms after endDate (prolongace). Requires endDate and renewalMonths.'),
  renewalMonths: z.number().int().positive().nullable().optional().describe('Length of each automatic renewal in months (e.g. 12)'),
  securityDeposit: z.number().int().nonnegative().nullable().optional().describe('Security deposit in haléře (CZK × 100)'),
  note: z.string().nullable().optional().describe('Internal note'),
});

const UpdateContractInput = z.object({
  id: z.string().describe('Contract ID'),
  startDate: DateStr.optional().describe('Contract start date (YYYY-MM-DD)'),
  endDate: DateStr.nullable().optional().describe('Contract end date (YYYY-MM-DD). For an auto-renewing contract, the original end of the fixed term.'),
  autoRenew: z.boolean().optional().describe('Turn automatic renewal on/off. Turning it off without endDate ends the contract at the end of the renewal period running today.'),
  renewalMonths: z.number().int().positive().nullable().optional().describe('Length of each automatic renewal in months'),
  securityDeposit: z.number().int().nonnegative().nullable().optional().describe('Security deposit in haléře'),
  note: z.string().nullable().optional().describe('Internal note'),
});

export async function listContracts(client: RentalApiClient, _args: z.infer<typeof ListContractsInput>) {
  const data = await client.get<{ contracts: unknown[] }>('/api/contracts');
  return data.contracts;
}

export async function getContract(client: RentalApiClient, args: z.infer<typeof GetContractInput>) {
  const data = await client.get<{ contract: unknown }>(`/api/contracts/${args.id}`);
  return data.contract;
}

export async function createContract(client: RentalApiClient, args: z.infer<typeof CreateContractInput>) {
  const data = await client.post<{ contract: unknown }>('/api/contracts', args);
  return data.contract as { id: string; [key: string]: unknown };
}

export async function updateContract(client: RentalApiClient, args: z.infer<typeof UpdateContractInput>) {
  const { id, ...body } = args;
  const data = await client.patch<{ contract: unknown }>(`/api/contracts/${id}`, body);
  return data.contract;
}

export function addContractTools(server: ToolSink, client: RentalApiClient) {
  server.addTool({
    name: 'contracts_list',
    description: 'List all contracts in the current organization. effectiveEndDate is endDate rolled forward through automatic renewals as of today.',
    parameters: ListContractsInput,
    execute: async (args) => JSON.stringify(await listContracts(client, args), null, 2),
  });

  server.addTool({
    name: 'contracts_get',
    description: 'Get a single contract by ID.',
    parameters: GetContractInput,
    execute: async (args) => JSON.stringify(await getContract(client, args), null, 2),
  });

  server.addTool({
    name: 'contracts_create',
    description: 'Create a new rental contract between a property and a tenant.',
    parameters: CreateContractInput,
    execute: async (args) => JSON.stringify(await createContract(client, args), null, 2),
  });

  server.addTool({
    name: 'contracts_update',
    description: 'Update an existing contract (end date, automatic renewal, security deposit, note).',
    parameters: UpdateContractInput,
    execute: async (args) => JSON.stringify(await updateContract(client, args), null, 2),
  });
}
