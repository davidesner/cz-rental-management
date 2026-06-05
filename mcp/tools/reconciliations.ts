import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { RentalApiClient } from '../client.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ListReconciliationsInput = z.object({
  contractId: z.string().optional().describe('Filter by contract ID'),
});

const GetReconciliationInput = z.object({
  id: z.string().describe('Reconciliation ID'),
});

const ComputeReconciliationInput = z.object({
  contractId: z.string().describe('Contract ID to reconcile'),
  periodFrom: DateStr.describe('Reconciliation period start (YYYY-MM-DD)'),
  periodTo: DateStr.describe('Reconciliation period end (YYYY-MM-DD)'),
  note: z.string().nullable().optional().describe('Internal note'),
});

const FinalizeReconciliationInput = z.object({
  id: z.string().describe('Reconciliation ID to finalize'),
});

const DeleteReconciliationInput = z.object({
  id: z.string().describe('Reconciliation ID to delete'),
});

export async function listReconciliations(client: RentalApiClient, args: z.infer<typeof ListReconciliationsInput>) {
  const params = new URLSearchParams();
  if (args.contractId) params.set('contractId', args.contractId);
  const qs = params.toString();
  const data = await client.get<{ reconciliations: unknown[] }>(`/api/reconciliations${qs ? `?${qs}` : ''}`);
  return data.reconciliations;
}

export async function getReconciliation(client: RentalApiClient, args: z.infer<typeof GetReconciliationInput>) {
  const data = await client.get<{ reconciliation: unknown }>(`/api/reconciliations/${args.id}`);
  return data.reconciliation;
}

export async function computeReconciliation(client: RentalApiClient, args: z.infer<typeof ComputeReconciliationInput>) {
  const { contractId, ...body } = args;
  const data = await client.post<{ reconciliation: unknown }>(`/api/contracts/${contractId}/reconciliations/compute`, body);
  return data.reconciliation as { id: string; items: Array<{ kind: string; paid: number; actualCost: number; difference: number }>; [key: string]: unknown };
}

export async function finalizeReconciliation(client: RentalApiClient, args: z.infer<typeof FinalizeReconciliationInput>) {
  const data = await client.patch<{ reconciliation: unknown }>(`/api/reconciliations/${args.id}/finalize`, {});
  return data.reconciliation;
}

export async function deleteReconciliation(client: RentalApiClient, args: z.infer<typeof DeleteReconciliationInput>) {
  await client.delete<void>(`/api/reconciliations/${args.id}`);
  return { deleted: true };
}

export function addReconciliationTools(server: FastMCP, client: RentalApiClient) {
  server.addTool({
    name: 'reconciliations_list',
    description: 'List reconciliations, optionally filtered by contract.',
    parameters: ListReconciliationsInput,
    execute: async (args) => JSON.stringify(await listReconciliations(client, args), null, 2),
  });

  server.addTool({
    name: 'reconciliations_get',
    description: 'Get a single reconciliation by ID.',
    parameters: GetReconciliationInput,
    execute: async (args) => JSON.stringify(await getReconciliation(client, args), null, 2),
  });

  server.addTool({
    name: 'reconciliations_compute',
    description: 'Compute a new reconciliation for a contract period. Calculates paid vs actual cost per utility/service kind and returns differences. Positive difference means tenant overpaid (refund due); negative means underpaid.',
    parameters: ComputeReconciliationInput,
    execute: async (args) => JSON.stringify(await computeReconciliation(client, args), null, 2),
  });

  server.addTool({
    name: 'reconciliations_finalize',
    description: 'Finalize a reconciliation, locking it from further changes.',
    parameters: FinalizeReconciliationInput,
    execute: async (args) => JSON.stringify(await finalizeReconciliation(client, args), null, 2),
  });

  server.addTool({
    name: 'reconciliations_delete',
    description: 'Delete a reconciliation permanently.',
    parameters: DeleteReconciliationInput,
    execute: async (args) => JSON.stringify(await deleteReconciliation(client, args), null, 2),
  });
}
