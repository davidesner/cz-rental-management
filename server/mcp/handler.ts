import { createMcpHandler, McpServer, type AuthInfo, type CallToolResult, type McpServerFactory } from '@modelcontextprotocol/server';
import { RentalApiClient, RentalApiError } from '../../mcp/client.js';
import { addAllTools } from '../../mcp/tools/index.js';
import type { ToolDefinition, ToolSink } from '../../mcp/tools/sink.js';
import { IN_PROCESS_USER, type InProcessEnv } from '../middleware/auth.js';

/** Server `instructions`: what the model needs before its first call. */
export const MCP_INSTRUCTIONS = [
  'Czech residential rental management: properties (nemovitosti), tenants (nájemníci), rental contracts (smlouvy)',
  'with temporal terms and utilities, payments, cost statements (vyúčtování, evidenční list) and the annual',
  'reconciliation (roční vyúčtování) between landlord and tenant.',
  'Money is always integer haléře (CZK x 100). Dates are YYYY-MM-DD.',
  'Ids come from list/get tools, never invent them.',
  'Never compute money in your head: use the reconciliation and payment-breakdown tools, which do the arithmetic.',
].join(' ');

const SERVER_INFO = { name: 'rental-management', title: 'Rental management', version: '1.0.0' };

/** Dispatches a REST request into the app in-process, as the given user. */
export type InProcessFetch = (req: Request, env: InProcessEnv) => Response | Promise<Response>;

/** The base URL of in-process requests. Hono routes on the path only; the host is never used. */
const IN_PROCESS_BASE = 'http://in-process.invalid';

/**
 * A REST client whose requests never leave the process: each one is handed to
 * the app with the verified user in `env`, so it runs through exactly the same
 * auth middleware, org scoping and validation as a browser request.
 */
function inProcessClient(dispatch: InProcessFetch, userId: string): RentalApiClient {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) =>
    dispatch(new Request(input, init), { [IN_PROCESS_USER]: userId })) as typeof fetch;
  // The bearer is a placeholder the middleware never reads (the env user wins).
  return new RentalApiClient(IN_PROCESS_BASE, 'in-process', fetchImpl);
}

/** Collects the tool definitions `add*Tools` register, bound to one client. */
function collectTools(client: RentalApiClient): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const sink: ToolSink = { addTool: (tool) => { tools.push(tool as unknown as ToolDefinition); } };
  addAllTools(sink, client);
  return tools;
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * A failed tool call as the model should see it: the REST error body (kind,
 * message, details) when the API refused the request, so it can correct the
 * arguments; a generic message for anything unexpected (logged, not echoed).
 */
function toolError(name: string, e: unknown): CallToolResult {
  if (e instanceof RentalApiError) {
    return errorResult(JSON.stringify({ status: e.status, error: e.body }, null, 2));
  }
  console.error(`[mcp] tool ${name} failed`, e);
  return errorResult('Internal error');
}

/** The user the `/mcp` route verified, carried in `authInfo.extra`. */
function userIdOf(authInfo: AuthInfo | undefined): string {
  const userId = (authInfo?.extra as { userId?: unknown } | undefined)?.userId;
  // Defence in depth: the route only calls the handler after verification.
  if (typeof userId !== 'string' || userId === '') throw new Error('MCP request without a verified user');
  return userId;
}

const JSON_MODE_NOTICE = "responseMode: 'json' drops mid-call notifications.";

/**
 * `createMcpHandler` prints a console notice on construction in `json` mode.
 * Dropping mid-call notifications is intended (no tool emits any), so exactly
 * that notice is filtered during the synchronous call.
 */
function withoutJsonModeNotice<T>(build: () => T): T {
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith(JSON_MODE_NOTICE)) return;
    warn(...args);
  };
  try {
    return build();
  } finally {
    console.warn = warn;
  }
}

/**
 * `subscriptions/listen` is a long-lived SSE stream that would hold a
 * serverless invocation open, and nothing here publishes change events. It is
 * answered method-not-found before the SDK sees it (`maxSubscriptions: 0` is
 * the backstop). The request is cloned so the SDK still gets the body.
 */
async function refuseListen(req: Request): Promise<Response | null> {
  if (req.method !== 'POST') return null;
  let body: unknown;
  try {
    body = await req.clone().json();
  } catch {
    return null;
  }
  const messages = Array.isArray(body) ? body : [body];
  const listen = messages.find(
    (m): m is { id?: string | number } =>
      typeof m === 'object' && m !== null && (m as { method?: unknown }).method === 'subscriptions/listen',
  );
  if (!listen) return null;
  return Response.json({ jsonrpc: '2.0', id: listen.id ?? null, error: { code: -32601, message: 'Method not found' } });
}

/**
 * Stateless streamable HTTP for both protocol eras: a fresh `McpServer` per
 * request, nothing kept in memory between requests (serverless-friendly),
 * JSON responses only. Token verification happens in the route; this handler
 * gets the verified user in `authInfo.extra.userId`.
 *
 * The tools are the same definitions the stdio npm package serves
 * (mcp/tools/), bound per request to an in-process REST client for that user.
 */
export function createMcpHttpHandler(dispatch: InProcessFetch) {
  const factory: McpServerFactory = ({ authInfo }) => {
    const client = inProcessClient(dispatch, userIdOf(authInfo));
    const server = new McpServer(SERVER_INFO, { instructions: MCP_INSTRUCTIONS });
    for (const tool of collectTools(client)) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.parameters },
        async (args: unknown): Promise<CallToolResult> => {
          try {
            return { content: [{ type: 'text', text: await tool.execute(args as never) }] };
          } catch (e) {
            return toolError(tool.name, e);
          }
        },
      );
    }
    return server;
  };
  const handler = withoutJsonModeNotice(() =>
    createMcpHandler(factory, { legacy: 'stateless', responseMode: 'json', maxSubscriptions: 0 }),
  );
  return {
    fetch: async (req: Request, opts: { authInfo: AuthInfo }) =>
      (await refuseListen(req)) ?? handler.fetch(req, { authInfo: opts.authInfo }),
  };
}
