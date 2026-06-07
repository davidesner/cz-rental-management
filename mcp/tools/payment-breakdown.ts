import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { RentalApiClient } from '../client.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Input = z.object({
  contractId: z.string(),
  from: DateStr.describe('Period start (YYYY-MM-DD)'),
  to: DateStr.describe('Period end (YYYY-MM-DD)'),
});

export async function paymentBreakdown(client: RentalApiClient, args: z.infer<typeof Input>) {
  return client.get<{
    months: Array<{
      month: string;
      daysActive: number;
      daysInMonth: number;
      expected: { baseRent: number; serviceAdvance: number; utilities: Record<string, number>; total: number };
      rentReduction: number;
      effectiveExpected: number;
      receivedTotal: number;
      allocation: {
        baseRentPaid: number;
        servicePaid: number;
        utilityPaid: Record<string, number>;
        surplus: number;
        deficitTotal: number;
      };
      paymentIds: string[];
    }>;
    rentReductions: Array<{ id: string; forMonth: string; amount: number; reason: string | null }>;
  }>(`/api/contracts/${args.contractId}/payment-breakdown?from=${args.from}&to=${args.to}`);
}

export function addPaymentBreakdownTools(server: FastMCP, client: RentalApiClient) {
  server.addTool({
    name: 'contracts_payment_breakdown',
    description: 'Compute the monthly payment breakdown (rozpis) for a contract over a period. For each month, returns: expected components (rent + service advance + utilities, prorated for partial months), applied rent reduction (srážka, if any), received total from payments, and rent-first allocation breakdown (paid per category + deficits). All money in haléře (CZK × 100). Allocation order: rent → service → utilities. Surplus over the plan appears as `surplus`. Deficit indicates underpayment.',
    parameters: Input,
    execute: async (args) => JSON.stringify(await paymentBreakdown(client, args), null, 2),
  });
}
