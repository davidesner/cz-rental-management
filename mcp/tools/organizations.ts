import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { RentalApiClient } from '../client.js';

const ListOrgsInput = z.object({});

const CreateOrgInput = z.object({
  name: z.string().min(1).max(200).describe('Organization name'),
});

export async function listOrganizations(client: RentalApiClient, _args: z.infer<typeof ListOrgsInput>) {
  const data = await client.get<{ organizations: unknown[] }>('/api/organizations');
  return data.organizations;
}

export async function createOrganization(client: RentalApiClient, args: z.infer<typeof CreateOrgInput>) {
  const data = await client.post<{ organization: unknown }>('/api/organizations', args);
  return data.organization;
}

export function addOrganizationTools(server: FastMCP, client: RentalApiClient) {
  server.addTool({
    name: 'organizations_list',
    description: 'List all organizations the current user belongs to.',
    parameters: ListOrgsInput,
    execute: async (args) => JSON.stringify(await listOrganizations(client, args), null, 2),
  });

  server.addTool({
    name: 'organizations_create',
    description: 'Create a new organization for the current user.',
    parameters: CreateOrgInput,
    execute: async (args) => JSON.stringify(await createOrganization(client, args), null, 2),
  });
}
