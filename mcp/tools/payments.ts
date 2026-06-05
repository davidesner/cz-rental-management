import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { RentalApiClient } from '../client.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const PaymentBodySchema = z.object({
  contractId: z.string().nullable().optional().describe('Assign payment to this contract ID'),
  amount: z.number().int().describe('Payment amount in haléře (CZK × 100)'),
  paidAt: DateStr.describe('Payment date (YYYY-MM-DD)'),
  counterparty: z.string().nullable().optional().describe('Counterparty name'),
  counterpartyAccount: z.string().nullable().optional().describe('Counterparty bank account'),
  externalId: z.string().nullable().optional().describe('External ID for idempotency (e.g. bank transaction hash)'),
  statementRef: z.string().nullable().optional().describe('Bank statement reference'),
  source: z.enum(['bank', 'manual']).describe('Payment source'),
  description: z.string().nullable().optional().describe('Payment description from bank'),
  note: z.string().nullable().optional().describe('Internal note'),
});

const ListPaymentsInput = z.object({
  contractId: z.string().optional().describe('Filter by contract ID'),
  unassigned: z.boolean().optional().describe('If true, return only unassigned payments'),
  from: DateStr.optional().describe('Filter payments from this date'),
  to: DateStr.optional().describe('Filter payments up to this date'),
});

const GetPaymentInput = z.object({
  id: z.string().describe('Payment ID'),
});

const RecordPaymentInput = PaymentBodySchema;

const RecordPaymentsBatchInput = z.object({
  payments: z.array(PaymentBodySchema).describe('Array of payments to record (idempotent via externalId)'),
});

const AssignPaymentInput = z.object({
  id: z.string().describe('Payment ID'),
  contractId: z.string().nullable().describe('Contract ID to assign to, or null to unassign'),
});

const UpdatePaymentInput = z.object({
  id: z.string().describe('Payment ID'),
  contractId: z.string().nullable().optional().describe('Assign/unassign contract'),
  amount: z.number().int().optional().describe('Payment amount in haléře'),
  paidAt: DateStr.optional().describe('Payment date'),
  counterparty: z.string().nullable().optional(),
  counterpartyAccount: z.string().nullable().optional(),
  statementRef: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

const DeletePaymentInput = z.object({
  id: z.string().describe('Payment ID'),
});

export async function listPayments(client: RentalApiClient, args: z.infer<typeof ListPaymentsInput>) {
  const params = new URLSearchParams();
  if (args.contractId) params.set('contractId', args.contractId);
  if (args.unassigned) params.set('unassigned', 'true');
  if (args.from) params.set('from', args.from);
  if (args.to) params.set('to', args.to);
  const qs = params.toString();
  const data = await client.get<{ payments: unknown[] }>(`/api/payments${qs ? `?${qs}` : ''}`);
  return data.payments;
}

export async function getPayment(client: RentalApiClient, args: z.infer<typeof GetPaymentInput>) {
  const data = await client.get<{ payment: unknown }>(`/api/payments/${args.id}`);
  return data.payment;
}

export async function recordPayment(client: RentalApiClient, args: z.infer<typeof RecordPaymentInput>) {
  const data = await client.post<{ payment: unknown }>('/api/payments', args);
  return data.payment;
}

export async function recordPaymentsBatch(client: RentalApiClient, args: z.infer<typeof RecordPaymentsBatchInput>) {
  const result = await client.post<{ created: unknown[]; existing: unknown[] }>('/api/payments/batch', args.payments);
  return result;
}

export async function assignPayment(client: RentalApiClient, args: z.infer<typeof AssignPaymentInput>) {
  const { id, contractId } = args;
  const data = await client.patch<{ payment: unknown }>(`/api/payments/${id}/assign`, { contractId });
  return data.payment;
}

export async function updatePayment(client: RentalApiClient, args: z.infer<typeof UpdatePaymentInput>) {
  const { id, ...body } = args;
  const data = await client.patch<{ payment: unknown }>(`/api/payments/${id}`, body);
  return data.payment;
}

export async function deletePayment(client: RentalApiClient, args: z.infer<typeof DeletePaymentInput>) {
  await client.delete<void>(`/api/payments/${args.id}`);
  return { deleted: true };
}

export function addPaymentTools(server: FastMCP, client: RentalApiClient) {
  server.addTool({
    name: 'payments_list',
    description: 'List payments, optionally filtered by contract, date range, or unassigned status.',
    parameters: ListPaymentsInput,
    execute: async (args) => JSON.stringify(await listPayments(client, args), null, 2),
  });

  server.addTool({
    name: 'payments_get',
    description: 'Get a single payment by ID.',
    parameters: GetPaymentInput,
    execute: async (args) => JSON.stringify(await getPayment(client, args), null, 2),
  });

  server.addTool({
    name: 'payments_record',
    description: 'Record a single payment.',
    parameters: RecordPaymentInput,
    execute: async (args) => JSON.stringify(await recordPayment(client, args), null, 2),
  });

  server.addTool({
    name: 'payments_record_batch',
    description: 'Record multiple payments at once. Idempotent: payments with matching externalId are skipped and returned in the "existing" array.',
    parameters: RecordPaymentsBatchInput,
    execute: async (args) => JSON.stringify(await recordPaymentsBatch(client, args), null, 2),
  });

  server.addTool({
    name: 'payments_assign',
    description: 'Assign or unassign a payment to/from a contract.',
    parameters: AssignPaymentInput,
    execute: async (args) => JSON.stringify(await assignPayment(client, args), null, 2),
  });

  server.addTool({
    name: 'payments_update',
    description: 'Update payment fields (amount, date, counterparty, note, etc.).',
    parameters: UpdatePaymentInput,
    execute: async (args) => JSON.stringify(await updatePayment(client, args), null, 2),
  });

  server.addTool({
    name: 'payments_delete',
    description: 'Delete a payment permanently.',
    parameters: DeletePaymentInput,
    execute: async (args) => JSON.stringify(await deletePayment(client, args), null, 2),
  });
}
