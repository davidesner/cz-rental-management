#!/usr/bin/env node
// agent-plugin/ ships two manifests for one plugin: .claude-plugin/plugin.json (Claude) and
// .codex-plugin/plugin.json (ChatGPT / Codex). Each client detects an update by its own
// manifest's version, so bumping one and forgetting the other leaves that client on the old
// skills. The marketplaces list the plugin by name; that must match too.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const claude = read('agent-plugin/.claude-plugin/plugin.json');
const codex = read('agent-plugin/.codex-plugin/plugin.json');
const marketplaces = [read('.claude-plugin/marketplace.json'), read('.agents/plugins/marketplace.json')];

const problems = [];
if (claude.version !== codex.version) {
  problems.push(`version: .claude-plugin ${claude.version} vs .codex-plugin ${codex.version}`);
}
if (claude.name !== codex.name) problems.push(`name: .claude-plugin ${claude.name} vs .codex-plugin ${codex.name}`);
for (const m of marketplaces) {
  if (!m.plugins?.some((p) => p.name === claude.name)) problems.push(`marketplace ${m.name} does not list ${claude.name}`);
}

if (problems.length) {
  console.error(`check-plugin-version: agent-plugin manifests disagree.\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-plugin-version: ok (${claude.name} ${claude.version})`);
