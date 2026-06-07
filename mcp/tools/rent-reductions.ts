import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { RentalApiClient } from '../client.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const AddInput = z.object({
  contractId: z.string(),
  forMonth: DateStr.describe("First day of the month, e.g. '2024-11-01'. The backend normalises mid-month dates to the 1st."),
  amount: z.number().int().nonnegative().describe('Reduction in haléře (CZK × 100)'),
  reason: z.string().nullable().optional(),
});

const ListInput = z.object({ contractId: z.string() });

const DeleteInput = z.object({
  contractId: z.string(),
  id: z.string().describe('Rent reduction ID'),
});

export async function addRentReduction(client: RentalApiClient, args: z.infer<typeof AddInput>) {
  const { contractId, ...body } = args;
  const data = await client.post<{ rentReduction: unknown }>(`/api/contracts/${contractId}/rent-reductions`, body);
  return data.rentReduction;
}

export async function listRentReductions(client: RentalApiClient, args: z.infer<typeof ListInput>) {
  const data = await client.get<{ rentReductions: unknown[] }>(`/api/contracts/${args.contractId}/rent-reductions`);
  return data.rentReductions;
}

export async function deleteRentReduction(client: RentalApiClient, args: z.infer<typeof DeleteInput>) {
  await client.delete(`/api/contracts/${args.contractId}/rent-reductions/${args.id}`);
  return { ok: true };
}

export function addRentReductionTools(server: FastMCP, client: RentalApiClient) {
  server.addTool({
    name: 'rent_reductions_add',
    description: 'Add a rent reduction (srážka) for a specific month of a contract. Use when the tenant paid for repairs the landlord is responsible for and the landlord agrees to reduce that month\'s rent by the amount. The reduction lowers the expected rent in the monthly payment breakdown.',
    parameters: AddInput,
    execute: async (args) => JSON.stringify(await addRentReduction(client, args), null, 2),
  });
  server.addTool({
    name: 'rent_reductions_list',
    description: 'List all rent reductions (srážky) for a contract.',
    parameters: ListInput,
    execute: async (args) => JSON.stringify(await listRentReductions(client, args), null, 2),
  });
  server.addTool({
    name: 'rent_reductions_delete',
    description: 'Delete a rent reduction by its ID.',
    parameters: DeleteInput,
    execute: async (args) => JSON.stringify(await deleteRentReduction(client, args), null, 2),
  });
}
