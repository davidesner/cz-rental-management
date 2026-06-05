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

export async function listContractUtilities(client: RentalApiClient, args: z.infer<typeof ListContractUtilitiesInput>) {
  const data = await client.get<{ utilities: unknown[] }>(`/api/contracts/${args.contractId}/utilities`);
  return data.utilities;
}

export async function addContractUtility(client: RentalApiClient, args: z.infer<typeof AddContractUtilityInput>) {
  const { contractId, ...body } = args;
  const data = await client.post<{ utility: unknown }>(`/api/contracts/${contractId}/utilities`, body);
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
}
