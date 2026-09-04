import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { RentalApiClient } from '../client.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const UtilityKind = z.enum(['electricity', 'gas', 'internet', 'water', 'other']);

const ListContractUtilitiesInput = z.object({
  contractId: z.string().describe('Contract ID'),
});

const AddContractUtilityInput = z.object({
  contractId: z.string().describe('Contract ID'),
  kind: UtilityKind.describe('Utility type'),
  validFrom: DateStr.describe('Date from which this utility advance applies (YYYY-MM-DD)'),
  monthlyAdvance: z.number().int().nonnegative().describe('Monthly advance for this utility in haléře (CZK × 100)'),
  note: z.string().nullable().optional().describe('Internal note'),
});

const UpdateContractUtilityInput = z.object({
  contractId: z.string().describe('Contract ID (the owning contract)'),
  utilityId: z.string().describe('ID of the utility row to update (from contract_utilities_list)'),
  monthlyAdvance: z.number().int().nonnegative().optional().describe('Corrected monthly advance in haléře (CZK × 100)'),
  note: z.string().nullable().optional().describe('Internal note — string nastaví, null odstraní'),
});

export async function listContractUtilities(client: RentalApiClient, args: z.infer<typeof ListContractUtilitiesInput>) {
  const data = await client.get<{ utilities: unknown[] }>(`/api/contracts/${args.contractId}/utilities`);
  return data.utilities;
}

export async function addContractUtility(client: RentalApiClient, args: z.infer<typeof AddContractUtilityInput>) {
  const { contractId, ...body } = args;
  const data = await client.post<{ utility: unknown }>(`/api/contracts/${contractId}/utilities`, body);
  return data.utility;
}

export async function updateContractUtility(client: RentalApiClient, args: z.infer<typeof UpdateContractUtilityInput>) {
  const { contractId, utilityId, ...body } = args;
  const data = await client.patch<{ utility: unknown }>(`/api/contracts/${contractId}/utilities/${utilityId}`, body);
  return data.utility;
}

export function addContractUtilityTools(server: FastMCP, client: RentalApiClient) {
  server.addTool({
    name: 'contract_utilities_list',
    description: 'List all utility advance history for a contract.',
    parameters: ListContractUtilitiesInput,
    execute: async (args) => JSON.stringify(await listContractUtilities(client, args), null, 2),
  });

  server.addTool({
    name: 'contract_utilities_add',
    description: 'Add a utility advance entry to a contract (electricity, gas, internet, water, other).',
    parameters: AddContractUtilityInput,
    execute: async (args) => JSON.stringify(await addContractUtility(client, args), null, 2),
  });

  server.addTool({
    name: 'contract_utilities_update',
    description: 'Update an existing utility row in-place — fix a mistyped advance or rewrite a stale note. kind + validFrom are immutable (they define the row\'s slot in the per-kind SCD2 chain); a genuine change from a given date belongs in contract_utilities_add instead.',
    parameters: UpdateContractUtilityInput,
    execute: async (args) => JSON.stringify(await updateContractUtility(client, args), null, 2),
  });
}
