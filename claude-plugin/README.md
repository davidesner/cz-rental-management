# rental-management — Claude Code plugin

Plugin pro správu pronájmu — pomáhá s ročním vyúčtováním nájemcům a s generováním smluv přes Claude Code + MCP backend.

## Co plugin obsahuje

- **Skill `rocni-vyuctovani`** — roční vyúčtování: parsování podkladů (SVJ, elektřina, bankovní výpisy), adjustmenty, zápis přes MCP, PDF pro nájemce
- **Skill `smlouvy`** — generování a reformat smluv a dodatků přes Typst (learn template z existujícího dokumentu / render z uložené šablony)
- **Skill `init`** + **`/rental-management:init` command** — založí pracovní složku s dokumenty, nebo přerovná existující

## Kde co žije

Plugin nese postup, tvoje pracovní složka znalost, data a výstupy:

| Kde | Co |
|---|---|
| `AGENTS.md` v kořeni | konvence + mapping název nemovitosti → složka |
| `<nemovitost>/_agent/` | metodika vyúčtování, parsery, fixtures, `pdf-<rok>.json` |
| `_agent/smlouvy/` | naučené Typst šablony + `INDEX.md` |

## Instalace

### Pro dev (local plugin path)

```bash
claude --plugin-dir /path/to/rental-management/claude-plugin
```

### Marketplace (až bude publikovaný)

```
/plugin install rental-management
```

## První spuštění

```
/rental-management:init
```

Skill `init` se zeptá, jestli zakládáš novou pracovní složku, nebo chceš přerovnat tu, kterou už máš. Založí `AGENTS.md`, kostru složek per nemovitost, a volitelně `.mcp.json` s napojením na backend.

Pak už jen řekni, co chceš — „spočítej vyúčtování <nemovitost>", „vyrob dodatek". Skilly se aktivují samy.

## Jak to funguje dál

- Při prvním vyúčtování konkrétní nemovitosti tě skill provede **learning mode** — společně vytvoříte `<nemovitost>/_agent/` s metodikou a parsery
- Při dalším použití pro tu stejnou nemovitost už použije uložené parsery automaticky
- Pokud se tvoje složky nejmenují jako slugy nemovitostí, zapiš mapping do `AGENTS.md`

## Update

`git pull`, nebo update přes marketplace.

## MCP backend

Plugin spoléhá na běžící `rental-management` MCP server, který je publikovaný jako samostatný npm balíček [`@esnerda/cz-rental-management-mcp`](https://www.npmjs.com/package/@esnerda/cz-rental-management-mcp) a spouští se přes `npx` (není potřeba clone repa). Skill `init` ti pomůže s `.mcp.json` konfigurací:

```json
{
  "mcpServers": {
    "rental-management": {
      "command": "npx",
      "args": ["-y", "@esnerda/cz-rental-management-mcp@latest"],
      "env": {
        "RENTAL_API_URL": "https://<your-app>",
        "RENTAL_API_TOKEN": "<from /settings/api-tokens>"
      }
    }
  }
}
```

`.mcp.json` obsahuje token — nedávej ho do gitu.
