import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { RentalApiClient } from '../client.js';

const ListTenantsInput = z.object({});

const GetTenantInput = z.object({
  id: z.string().describe('Tenant ID'),
});

const CreateTenantInput = z.object({
  name: z.string().min(1).max(200).describe('Tenant full name'),
  email: z.string().email().nullable().optional().describe('Tenant email'),
  phone: z.string().nullable().optional().describe('Tenant phone number'),
  accountNumber: z.string().nullable().optional().describe('Tenant bank account number'),
  note: z.string().nullable().optional().describe('Internal note'),
});

const UpdateTenantInput = z.object({
  id: z.string().describe('Tenant ID'),
  name: z.string().min(1).max(200).optional().describe('Tenant full name'),
  email: z.string().email().nullable().optional().describe('Tenant email'),
  phone: z.string().nullable().optional().describe('Tenant phone number'),
  accountNumber: z.string().nullable().optional().describe('Tenant bank account number'),
  note: z.string().nullable().optional().describe('Internal note'),
});

export async function listTenants(client: RentalApiClient, _args: z.infer<typeof ListTenantsInput>) {
  const data = await client.get<{ tenants: unknown[] }>('/api/tenants');
  return data.tenants;
}

export async function getTenant(client: RentalApiClient, args: z.infer<typeof GetTenantInput>) {
  const data = await client.get<{ tenant: unknown }>(`/api/tenants/${args.id}`);
  return data.tenant;
}

export async function createTenant(client: RentalApiClient, args: z.infer<typeof CreateTenantInput>) {
  const data = await client.post<{ tenant: unknown }>('/api/tenants', args);
  return data.tenant as { id: string; name: string; [key: string]: unknown };
}

export async function updateTenant(client: RentalApiClient, args: z.infer<typeof UpdateTenantInput>) {
  const { id, ...body } = args;
  const data = await client.patch<{ tenant: unknown }>(`/api/tenants/${id}`, body);
  return data.tenant;
}

export function addTenantTools(server: FastMCP, client: RentalApiClient) {
  server.addTool({
    name: 'tenants_list',
    description: 'List all tenants in the current organization.',
    parameters: ListTenantsInput,
    execute: async (args) => JSON.stringify(await listTenants(client, args), null, 2),
  });

  server.addTool({
    name: 'tenants_get',
    description: 'Get a single tenant by ID.',
    parameters: GetTenantInput,
    execute: async (args) => JSON.stringify(await getTenant(client, args), null, 2),
  });

  server.addTool({
    name: 'tenants_create',
    description: 'Create a new tenant.',
    parameters: CreateTenantInput,
    execute: async (args) => JSON.stringify(await createTenant(client, args), null, 2),
  });

  server.addTool({
    name: 'tenants_update',
    description: 'Update an existing tenant.',
    parameters: UpdateTenantInput,
    execute: async (args) => JSON.stringify(await updateTenant(client, args), null, 2),
  });
}
