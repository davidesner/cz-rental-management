import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { RentalApiClient } from '../client.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Kind = z.enum(['services', 'electricity', 'gas', 'internet', 'water', 'other']);

const ListCostStatementsInput = z.object({
  propertyId: z.string().optional().describe('Filter by property ID'),
  kind: Kind.optional().describe('Filter by kind'),
  from: DateStr.optional().describe('Filter statements from this period start'),
  to: DateStr.optional().describe('Filter statements up to this period end'),
});

const GetCostStatementInput = z.object({
  id: z.string().describe('Cost statement ID'),
});

const CreateCostStatementInput = z.object({
  propertyId: z.string().describe('Property ID'),
  kind: Kind.describe('Type of cost'),
  periodFrom: DateStr.describe('Period start date (YYYY-MM-DD)'),
  periodTo: DateStr.describe('Period end date (YYYY-MM-DD)'),
  totalAmount: z.number().int().describe('Total cost in haléře (CZK × 100)'),
  adjustmentAmount: z.number().int().optional().describe('Adjustment amount in haléře (negative = reduces cost charged to tenant, e.g. Fond oprav deduction)'),
  adjustmentNote: z.string().nullable().optional().describe('Human-readable explanation of adjustment'),
  documentRef: z.string().nullable().optional().describe('Reference to source document (filename, invoice number, etc.)'),
  issuedAt: DateStr.nullable().optional().describe('Date the document was issued'),
  note: z.string().nullable().optional().describe('Internal note'),
});

const UpdateCostStatementInput = z.object({
  id: z.string().describe('Cost statement ID'),
  propertyId: z.string().optional(),
  kind: Kind.optional(),
  periodFrom: DateStr.optional(),
  periodTo: DateStr.optional(),
  totalAmount: z.number().int().optional(),
  adjustmentAmount: z.number().int().optional(),
  adjustmentNote: z.string().nullable().optional(),
  documentRef: z.string().nullable().optional(),
  issuedAt: DateStr.nullable().optional(),
  note: z.string().nullable().optional(),
});

const DeleteCostStatementInput = z.object({
  id: z.string().describe('Cost statement ID'),
});

export async function listCostStatements(client: RentalApiClient, args: z.infer<typeof ListCostStatementsInput>) {
  const params = new URLSearchParams();
  if (args.propertyId) params.set('propertyId', args.propertyId);
  if (args.kind) params.set('kind', args.kind);
  if (args.from) params.set('from', args.from);
  if (args.to) params.set('to', args.to);
  const qs = params.toString();
  const data = await client.get<{ statements: unknown[] }>(`/api/cost-statements${qs ? `?${qs}` : ''}`);
  return data.statements;
}

export async function getCostStatement(client: RentalApiClient, args: z.infer<typeof GetCostStatementInput>) {
  const data = await client.get<{ statement: unknown }>(`/api/cost-statements/${args.id}`);
  return data.statement;
}

export async function createCostStatement(client: RentalApiClient, args: z.infer<typeof CreateCostStatementInput>) {
  const data = await client.post<{ statement: unknown }>('/api/cost-statements', args);
  return data.statement as { id: string; [key: string]: unknown };
}

export async function updateCostStatement(client: RentalApiClient, args: z.infer<typeof UpdateCostStatementInput>) {
  const { id, ...body } = args;
  const data = await client.patch<{ statement: unknown }>(`/api/cost-statements/${id}`, body);
  return data.statement;
}

export async function deleteCostStatement(client: RentalApiClient, args: z.infer<typeof DeleteCostStatementInput>) {
  await client.delete<void>(`/api/cost-statements/${args.id}`);
  return { deleted: true };
}

export function addCostStatementTools(server: FastMCP, client: RentalApiClient) {
  server.addTool({
    name: 'cost_statements_list',
    description: 'List cost statements, optionally filtered by property, kind, or date range.',
    parameters: ListCostStatementsInput,
    execute: async (args) => JSON.stringify(await listCostStatements(client, args), null, 2),
  });

  server.addTool({
    name: 'cost_statements_get',
    description: 'Get a single cost statement by ID.',
    parameters: GetCostStatementInput,
    execute: async (args) => JSON.stringify(await getCostStatement(client, args), null, 2),
  });

  server.addTool({
    name: 'cost_statements_create',
    description: 'Create a new cost statement (SVJ services, electricity, gas, etc.) for a property.',
    parameters: CreateCostStatementInput,
    execute: async (args) => JSON.stringify(await createCostStatement(client, args), null, 2),
  });

  server.addTool({
    name: 'cost_statements_update',
    description: 'Update an existing cost statement.',
    parameters: UpdateCostStatementInput,
    execute: async (args) => JSON.stringify(await updateCostStatement(client, args), null, 2),
  });

  server.addTool({
    name: 'cost_statements_delete',
    description: 'Delete a cost statement permanently.',
    parameters: DeleteCostStatementInput,
    execute: async (args) => JSON.stringify(await deleteCostStatement(client, args), null, 2),
  });
}
