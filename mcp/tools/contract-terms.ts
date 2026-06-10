import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { RentalApiClient } from '../client.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ListContractTermsInput = z.object({
  contractId: z.string().describe('Contract ID'),
});

const AddContractTermsInput = z.object({
  contractId: z.string().describe('Contract ID'),
  validFrom: DateStr.describe('Date from which these terms apply (YYYY-MM-DD)'),
  baseRent: z.number().int().nonnegative().describe('Monthly base rent in haléře (CZK × 100)'),
  serviceAdvance: z.number().int().nonnegative().describe('Monthly service advance in haléře'),
  paymentDueDay: z.number().int().min(1).max(31).optional().describe('Day of month rent is due (1-31, default inherited from prior terms or 10)'),
  paymentAppliesTo: z.enum(['current', 'next']).optional().describe('"current" = due in same month as rent period; "next" = paid in advance (prior month). Default inherited.'),
  source: z.enum(['initial', 'addendum', 'change']).describe('Source of the terms change'),
  documentRef: z.string().nullable().optional().describe('Link/path k zdrojovému dokumentu (URL na Drive/cesta na disk) — pro initial = původní smlouva, pro addendum/change = dodatek PDF'),
  note: z.string().nullable().optional().describe('Internal note'),
});

const UpdateContractTermsInput = z.object({
  contractId: z.string().describe('Contract ID (the owning contract)'),
  termsId: z.string().describe('ID of the terms row to update'),
  baseRent: z.number().int().nonnegative().optional().describe('Monthly base rent in haléře'),
  serviceAdvance: z.number().int().nonnegative().optional().describe('Monthly service advance in haléře'),
  paymentDueDay: z.number().int().min(1).max(31).optional().describe('Day of month rent is due (1-31)'),
  paymentAppliesTo: z.enum(['current', 'next']).optional().describe('"current" = due in same month; "next" = paid in advance (prior month)'),
  source: z.enum(['initial', 'addendum', 'change']).optional().describe('Source of the terms change'),
  documentRef: z.string().nullable().optional().describe('Link/path k dokumentu — null odstraní, string nastaví'),
  note: z.string().nullable().optional().describe('Internal note'),
});

export async function listContractTerms(client: RentalApiClient, args: z.infer<typeof ListContractTermsInput>) {
  const data = await client.get<{ terms: unknown[] }>(`/api/contracts/${args.contractId}/terms`);
  return data.terms;
}

export async function addContractTerms(client: RentalApiClient, args: z.infer<typeof AddContractTermsInput>) {
  const { contractId, ...body } = args;
  const data = await client.post<{ terms: unknown }>(`/api/contracts/${contractId}/terms`, body);
  return data.terms;
}

export async function updateContractTerms(client: RentalApiClient, args: z.infer<typeof UpdateContractTermsInput>) {
  const { contractId, termsId, ...body } = args;
  const data = await client.patch<{ terms: unknown }>(`/api/contracts/${contractId}/terms/${termsId}`, body);
  return data.terms;
}

export function addContractTermsTools(server: FastMCP, client: RentalApiClient) {
  server.addTool({
    name: 'contract_terms_list',
    description: 'List all terms history for a contract.',
    parameters: ListContractTermsInput,
    execute: async (args) => JSON.stringify(await listContractTerms(client, args), null, 2),
  });

  server.addTool({
    name: 'contract_terms_add',
    description: 'Add new terms (rent/advance amounts + payment timing) to a contract, effective from a given date. Closes prior open terms.',
    parameters: AddContractTermsInput,
    execute: async (args) => JSON.stringify(await addContractTerms(client, args), null, 2),
  });

  server.addTool({
    name: 'contract_terms_update',
    description: 'Update an existing terms row in-place (fix typo, change baseRent/payment timing/note/source). validFrom + contractId are immutable — to move a terms row in time, delete and re-add.',
    parameters: UpdateContractTermsInput,
    execute: async (args) => JSON.stringify(await updateContractTerms(client, args), null, 2),
  });
}
