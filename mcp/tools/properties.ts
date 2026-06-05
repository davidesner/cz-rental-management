import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { RentalApiClient } from '../client.js';

const ListPropertiesInput = z.object({});

const GetPropertyInput = z.object({
  id: z.string().describe('Property ID'),
});

const CreatePropertyInput = z.object({
  name: z.string().min(1).max(200).describe('Property name'),
  address: z.string().nullable().optional().describe('Property address'),
  reconciliationSkill: z.string().nullable().optional().describe('Skill directory name for reconciliation workflow'),
  note: z.string().nullable().optional().describe('Internal note'),
});

const UpdatePropertyInput = z.object({
  id: z.string().describe('Property ID'),
  name: z.string().min(1).max(200).optional().describe('Property name'),
  address: z.string().nullable().optional().describe('Property address'),
  reconciliationSkill: z.string().nullable().optional().describe('Skill directory name for reconciliation workflow'),
  note: z.string().nullable().optional().describe('Internal note'),
});

export async function listProperties(client: RentalApiClient, _args: z.infer<typeof ListPropertiesInput>) {
  const data = await client.get<{ properties: unknown[] }>('/api/properties');
  return data.properties;
}

export async function getProperty(client: RentalApiClient, args: z.infer<typeof GetPropertyInput>) {
  const data = await client.get<{ property: unknown }>(`/api/properties/${args.id}`);
  return data.property;
}

export async function createProperty(client: RentalApiClient, args: z.infer<typeof CreatePropertyInput>) {
  const data = await client.post<{ property: unknown }>('/api/properties', args);
  return data.property as { id: string; name: string; [key: string]: unknown };
}

export async function updateProperty(client: RentalApiClient, args: z.infer<typeof UpdatePropertyInput>) {
  const { id, ...body } = args;
  const data = await client.patch<{ property: unknown }>(`/api/properties/${id}`, body);
  return data.property;
}

export function addPropertyTools(server: FastMCP, client: RentalApiClient) {
  server.addTool({
    name: 'properties_list',
    description: 'List all properties in the current organization.',
    parameters: ListPropertiesInput,
    execute: async (args) => JSON.stringify(await listProperties(client, args), null, 2),
  });

  server.addTool({
    name: 'properties_get',
    description: 'Get a single property by ID.',
    parameters: GetPropertyInput,
    execute: async (args) => JSON.stringify(await getProperty(client, args), null, 2),
  });

  server.addTool({
    name: 'properties_create',
    description: 'Create a new property in the current organization.',
    parameters: CreatePropertyInput,
    execute: async (args) => JSON.stringify(await createProperty(client, args), null, 2),
  });

  server.addTool({
    name: 'properties_update',
    description: 'Update an existing property.',
    parameters: UpdatePropertyInput,
    execute: async (args) => JSON.stringify(await updateProperty(client, args), null, 2),
  });
}
