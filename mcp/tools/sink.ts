import type { z } from 'zod';

/** One tool as the `add*Tools` functions describe it. */
export interface ToolDefinition<P extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  parameters: P;
  /** Receives the parsed arguments; returns the result as JSON text. */
  execute: (args: z.output<P>) => Promise<string>;
}

/**
 * Where `add*Tools` register their tools. FastMCP satisfies it for the stdio
 * server (mcp/index.ts); the remote `/mcp` endpoint (server/mcp/) collects the
 * same definitions per request.
 */
export interface ToolSink {
  addTool<P extends z.ZodObject>(tool: ToolDefinition<P>): void;
}
