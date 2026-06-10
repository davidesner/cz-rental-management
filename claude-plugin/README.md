# rental-management — Claude Code plugin

Plugin pro správu pronájmu — pomáhá s ročním vyúčtováním nájemcům přes Claude Code + MCP backend.

## Co plugin obsahuje

- **`/rental-management:init` command** (`commands/init.md`) — bootstrapuje lokální workflow skill z přibalené šablony
- **`/rental-management:update` command** (`commands/update.md`) — synchronizuje lokální skill s aktuální template verzí (zachovává `properties/` a `fixtures/`)
- **Šablona workflow skillu** (`templates/skill/`) — kostra pro user-owned skill, kterou si nainstaluješ a budeš rozvíjet lokálně

## Filozofie

Plugin **neposkytuje** workflow skill přímo. Místo toho ti pomůže udělat **vlastní lokální kopii**, kterou si budeš upravovat (parsery per nemovitost, fixtures, pravidla). Tím se na update pluginu neztratí tvoje data.

## Instalace

### Pro dev (local plugin path)

```bash
claude --plugin-dir /path/to/rental-management/claude-plugin
```

V Claude Code session pak invokuj setup:

```
/rental-management:init
```

Plugin se zeptá kam nainstalovat tvůj lokální skill, případně pomůže s `.mcp.json` konfigem.

## Update lokálního skillu

Po `git pull` pluginu (nebo po update přes marketplace) spusť:

```
/rental-management:update
```

Sync detekuje co se v template změnilo, ukáže per-soubor diff, nabídne overwrite / manual merge / skip. `properties/` a `fixtures/` jsou user-owned — nikdy se jich nedotkne.

### Marketplace (až bude publikovaný)

```
/plugin install rental-management
```

## Po instalaci lokálního skillu

- Lokální skill žije defaultně v `~/.claude/skills/rental-management/`
- Claude Code ho automaticky discover-uje
- Při prvním použití pro konkrétní property tě skill provede **learning mode** — vytvoří `properties/<slug>/` se vším co potřebuje (parsery, pravidla, fixtures)
- Při dalším použití pro tu stejnou property už použije uložené parsery automaticky

## Update

Plugin → můžeš pravidelně updatovat (např. `git pull`). Lokální skill se neudělá automaticky — spusť znovu `init` skill a vyber **merge** mode (zachová tvoje `properties/`, jen updatne sdílené části jako `SKILL.md` template).

## MCP backend

Plugin spoléhá na běžící `rental-management` MCP server (definovaný v `mcp/index.ts` rental-management projektu). Plugin `init` skill ti pomůže s `.mcp.json` konfigurací.
