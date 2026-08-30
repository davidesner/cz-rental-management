#!/usr/bin/env node
// The MCP server reports its version to the client over the protocol handshake, and
// that number is a literal in mcp/index.ts — FastMCP takes it as a constructor arg,
// so nothing links it to mcp/package.json. Bumping the package for a release and
// forgetting the literal ships a server that lies about which version it is.
//
// Reading package.json at runtime instead would be the self-maintaining fix, but the
// path differs between `tsx mcp/index.ts` (dev) and `dist/index.js` (published), so it
// needs a two-candidate lookup with a silent fallback — a wrong version reported
// quietly. Failing loudly in CI is the cheaper trade.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(repoRoot, 'mcp', 'package.json');
const entryPath = join(repoRoot, 'mcp', 'index.ts');

const pkgVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version;

// Deliberately anchored to the FastMCP constructor rather than any `version:` in the
// file, so an unrelated field named `version` elsewhere can't satisfy the check.
const entry = readFileSync(entryPath, 'utf8');
const match = entry.match(/new FastMCP\(\{[^}]*?version:\s*'([^']+)'/s);

if (!match) {
  console.error(
    `check-mcp-version: no \`version\` found in the FastMCP constructor in mcp/index.ts.\n` +
      `If the constructor was restructured, update this check to match.`,
  );
  process.exit(1);
}

const entryVersion = match[1];

if (entryVersion !== pkgVersion) {
  console.error(
    `check-mcp-version: version mismatch.\n` +
      `  mcp/package.json : ${pkgVersion}\n` +
      `  mcp/index.ts     : ${entryVersion}\n\n` +
      `Set the FastMCP constructor in mcp/index.ts to '${pkgVersion}'.`,
  );
  process.exit(1);
}

console.log(`check-mcp-version: ok (${pkgVersion})`);
