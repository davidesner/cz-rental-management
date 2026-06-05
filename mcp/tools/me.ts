import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { RentalApiClient } from '../client.js';

const GetMeInput = z.object({});

export async function getMe(client: RentalApiClient, _args: z.infer<typeof GetMeInput>) {
  return client.get<unknown>('/api/me');
}

export function addMeTools(server: FastMCP, client: RentalApiClient) {
  server.addTool({
    name: 'me_get',
    description: 'Get the currently authenticated user along with their organization memberships and active org.',
    parameters: GetMeInput,
    execute: async (args) => JSON.stringify(await getMe(client, args), null, 2),
  });
}
