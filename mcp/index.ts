#!/usr/bin/env node
import 'dotenv/config';
import { FastMCP, type FastMCPSessionAuth, type Tool } from 'fastmcp';
import { RentalApiClient } from './client.js';
import { addAllTools } from './tools/index.js';
import type { ToolSink } from './tools/sink.js';

const apiUrl = process.env['RENTAL_API_URL'] ?? 'http://localhost:3000';
const apiToken = process.env['RENTAL_API_TOKEN'];
if (!apiToken) {
  console.error('RENTAL_API_TOKEN is required');
  process.exit(1);
}

const client = new RentalApiClient(apiUrl, apiToken);
const server = new FastMCP({
  name: 'rental-management',
  version: '0.4.0',
});

// FastMCP types tool arguments through Standard Schema, the sink through zod:
// the same parsed values at runtime, only the type-level inference differs.
const tools: ToolSink = {
  addTool: (tool) => server.addTool(tool as unknown as Tool<FastMCPSessionAuth>),
};

addAllTools(tools, client);

server.start({ transportType: 'stdio' });
