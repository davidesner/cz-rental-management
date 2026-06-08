import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { RentalApiClient } from '../client.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ListPropertyTariffsInput = z.object({
  propertyId: z.string().describe('Property ID'),
});

const AddPropertyTariffInput = z.object({
  propertyId: z.string().describe('Property ID'),
  validFrom: DateStr.describe('Date from which this SVJ tariff applies (YYYY-MM-DD)'),
  totalSvjAdvance: z.number().int().nonnegative().describe('Total SVJ monthly advance in haléře (CZK × 100)'),
  deductibleAmount: z.number().int().nonnegative().describe('Deductible portion (e.g. Fond oprav) not charged to tenant, in haléře'),
  deductibleNote: z.string().nullable().optional().describe('Description of what is deducted (e.g. "Fond oprav + správa")'),
  documentRef: z.string().nullable().optional().describe('Link/path to source evidence list document (e.g. Google Drive URL, file path)'),
  note: z.string().nullable().optional().describe('Internal note'),
});

export async function listPropertyTariffs(client: RentalApiClient, args: z.infer<typeof ListPropertyTariffsInput>) {
  const data = await client.get<{ tariffs: unknown[] }>(`/api/properties/${args.propertyId}/tariffs`);
  return data.tariffs;
}

export async function addPropertyTariff(client: RentalApiClient, args: z.infer<typeof AddPropertyTariffInput>) {
  const { propertyId, ...body } = args;
  const data = await client.post<{ tariff: unknown }>(`/api/properties/${propertyId}/tariffs`, body);
  return data.tariff;
}

export function addPropertyTariffTools(server: FastMCP, client: RentalApiClient) {
  server.addTool({
    name: 'property_tariffs_list',
    description: 'List all SVJ tariff history for a property.',
    parameters: ListPropertyTariffsInput,
    execute: async (args) => JSON.stringify(await listPropertyTariffs(client, args), null, 2),
  });

  server.addTool({
    name: 'property_tariffs_add',
    description: 'Add an SVJ tariff entry to a property, specifying total advance and the deductible portion not charged to tenant.',
    parameters: AddPropertyTariffInput,
    execute: async (args) => JSON.stringify(await addPropertyTariff(client, args), null, 2),
  });
}
