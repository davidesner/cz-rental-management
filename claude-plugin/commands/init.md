---
description: Setup lokálního rental-management workflow skillu — zkopíruje template z pluginu do user-zvolené cesty. Spustit jednou po instalaci pluginu.
---

# Init: Setup local rental-management workflow skill

You are helping the user bootstrap their local copy of the rental-management workflow skill. This skill will be **user-owned** — it grows over time with per-property parsers, rules, and fixtures. Keeping it separate from the plugin lets the user customize without losing changes on plugin update.

## Step 1: Locate the plugin's template

The template lives at `<plugin-dir>/templates/skill/` relative to this SKILL.md.

Use Bash to resolve the actual path:

```bash
# This SKILL.md lives at <plugin>/skills/init/SKILL.md
# Template is at <plugin>/templates/skill/
SKILL_DIR=$(cd "$(dirname "$0")" && pwd)  # if invoked from a script
# In Claude Code, locate by walking up from a known marker file or asking the user
```

Practical: ask user where their plugin is installed if you can't infer (commonly `~/.claude/plugins/...` or wherever they cloned the repo). Don't guess — confirm.

## Step 2: Ask user where to install

Default: `~/.claude/skills/rental-management`

Alternative paths:
- A project workspace (e.g. `~/my-rentals/skill`) — then ask if they want a symlink `~/.claude/skills/rental-management → <target>` so Claude Code can find it
- Anywhere — explain that Claude Code looks in `~/.claude/skills/` by default, so symlink is required if elsewhere

Confirm path with user before proceeding.

## Step 3: Check target

- If target directory **doesn't exist**: create it
- If target **exists and is empty**: continue
- If target **exists and non-empty**: ask user:
  - "Overwrite (loses local data)"
  - "Merge (keep existing per-property data, update template files)" — recommended for updates
  - "Abort"

## Step 4: Copy template

```bash
mkdir -p <target>
cp -R <plugin>/templates/skill/. <target>/
```

If merging, only copy files that don't exist in target (use `cp -n -R` or check per-file).

## Step 5: Optional — register with Claude Code

If user chose a non-default path:

```bash
ln -s <target> ~/.claude/skills/rental-management
```

If `~/.claude/skills/rental-management` already exists, ask before overwriting.

## Step 6: Optional — help with MCP config

Ask user: "Do you want me to add a `.mcp.json` entry for the rental backend in your current workspace?"

If yes:
1. Ask for API URL (default: `http://localhost:3000` for local dev)
2. Ask for API token (instruct: generate in app at `/settings/api-tokens`)
3. Write or merge into `<cwd>/.mcp.json`:

```json
{
  "mcpServers": {
    "rental-management": {
      "command": "pnpm",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/rental-management",
      "env": {
        "RENTAL_API_URL": "<URL>",
        "RENTAL_API_TOKEN": "<TOKEN>"
      }
    }
  }
}
```

(Once `@david/rental-mcp` is published to npm, swap to `npx -y @david/rental-mcp@latest`.)

## Step 7: Report

Tell user:
- Local skill installed at `<target>` — obsahuje:
  - Hlavní reconciliation skill (`SKILL.md`)
  - Sub-skill `contracts/` pro generování smluv a dodatků (Typst-based, viz `contracts/SKILL.md`)
- (If applicable) symlink created
- (If applicable) `.mcp.json` updated
- "Restart Claude Code to pick up changes"
- "Then invoke me via 'compute reconciliation' / 'process rental bills' (reconciliation) nebo 'vyrob dodatek' / 'udělej smlouvu' (contracts) — workflow skills tě provedou"
- Doporučit `brew install typst pandoc poppler` pro contracts skill pokud nejsou (typst pro kompilaci, pandoc pro DOCX→MD, poppler pro PDF preview)

## Safety

- **Never** overwrite user data without explicit consent
- **Always** show what you will copy/symlink before doing it
- Local skill is user-owned — `properties/` and `fixtures/` contain personal data, don't touch them on subsequent runs of init
