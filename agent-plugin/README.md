# rental-management: plugin pro Claude a ChatGPT

Plugin pro správu pronájmu: **konektor na aplikaci rental-management** (remote MCP,
přihlášení přes OAuth) spolu se **skilly**, které agenta naučí roční vyúčtování nájemcům
a generování smluv a dodatků. Jeden plugin pro Claude (Claude Code, Cowork, claude.ai,
Claude Desktop) i ChatGPT (desktop, Codex).

## Co plugin obsahuje

- **Konektor `rental-management`**: `https://cz-rental-management.vercel.app/mcp`
  (`.mcp.json`). Při prvním použití se přihlásíš e-mailem a heslem a potvrdíš
  **Povolit**. Žádný API token se nekopíruje.
- **Skill `rocni-vyuctovani`**: roční vyúčtování: parsování podkladů (SVJ, elektřina,
  bankovní výpisy), adjustmenty, zápis přes MCP, PDF pro nájemce
- **Skill `smlouvy`**: generování a reformat smluv a dodatků přes Typst (learn template
  z existujícího dokumentu / render z uložené šablony)
- **Skill `init`** + command **`/rental-management:init`** (jen Claude): založí pracovní
  složku s dokumenty, nebo přerovná existující

## Instalace

### Claude Code / Cowork

Tenhle repozitář je marketplace:

```
/plugin install rental-management --marketplace davidesner/cz-rental-management
```

nebo `claude plugin marketplace add davidesner/cz-rental-management` a
`claude plugin install rental-management@rental-management`. Admin Cowork organizace může
repozitář přidat jako org marketplace.

### claude.ai / Claude Desktop (upload)

`plugin-dist/rental-management-claude.zip` (postav ho `./scripts/build-plugin.sh`).

### ChatGPT desktop / Codex

Repozitář je i marketplace pro ChatGPT / Codex (`.agents/plugins/marketplace.json`):

```bash
codex plugin marketplace add davidesner/cz-rental-management
```

pak nainstaluj `rental-management@rental-management`. Případně nahraj
`plugin-dist/rental-management-chatgpt.zip`. Konektor je v pluginu přibalený (manifest
`.codex-plugin/plugin.json` s `mcpServers: "./.mcp.json"`), samostatný konektor v ChatGPT
přidávat nemusíš. Přibalené MCP funguje jen v desktopové aplikaci; ve webovém ChatGPT
přidej konektor ručně (Settings → Apps and Connectors → Developer mode → Create, URL
výše, OAuth s dynamickou registrací).

### Vlastní nasazení aplikace

Konektor míří na hlavní nasazení. Pro vlastní instanci postav balíčky s její adresou:

```bash
./scripts/build-plugin.sh https://<tvoje-app>
```

### Lokální vývoj

```bash
claude --plugin-dir /path/to/rental-management/agent-plugin
```

## První spuštění

```
/rental-management:init
```

(v ChatGPT stačí napsat „založ složku na byty"). Skill `init` se zeptá, jestli zakládáš
novou pracovní složku, nebo chceš přerovnat tu, kterou už máš. Založí `AGENTS.md` a kostru
složek per nemovitost.

Pak už jen řekni, co chceš: „spočítej vyúčtování <nemovitost>", „vyrob dodatek". Skilly
se aktivují samy.

## Kde co žije

Plugin nese postup, tvoje pracovní složka znalost, data a výstupy:

| Kde | Co |
|---|---|
| `AGENTS.md` v kořeni | konvence + mapping název nemovitosti → složka |
| `<nemovitost>/_agent/` | metodika vyúčtování, parsery, fixtures, `pdf-<rok>.json` |
| `_agent/smlouvy/` | naučené Typst šablony + `INDEX.md` |

## Jak to funguje dál

- Při prvním vyúčtování konkrétní nemovitosti tě skill provede **learning mode**: společně
  vytvoříte `<nemovitost>/_agent/` s metodikou a parsery
- Při dalším použití pro tu stejnou nemovitost už použije uložené parsery automaticky
- Pokud se tvoje složky nejmenují jako slugy nemovitostí, zapiš mapping do `AGENTS.md`

## Struktura pluginu

| Cesta | Co |
|---|---|
| `.claude-plugin/plugin.json` | manifest pro Claude |
| `.codex-plugin/plugin.json` | manifest pro ChatGPT / Codex (skills + přibalené MCP) |
| `.mcp.json` | konektor (jen URL, žádný token) |
| `skills/`, `commands/` | skilly a Claude command |
| `../.claude-plugin/marketplace.json`, `../.agents/plugins/marketplace.json` | marketplaces v kořeni repa |

Verze v obou manifestech musí sedět (`pnpm check:plugin-version`, hlídá CI).

## Update

Update přes marketplace (`/plugin marketplace update`, v Codexu `codex plugin marketplace upgrade`),
nebo `git pull` u lokální cesty.

## Bez pluginu: jen konektor

Konektor jde přidat i samostatně, bez skillů:

```bash
claude mcp add --transport http --scope user rental-management https://<your-app>/mcp
```

Pro klienty bez remote MCP zůstává legacy stdio balíček
[`@esnerda/cz-rental-management-mcp`](https://www.npmjs.com/package/@esnerda/cz-rental-management-mcp)
spouštěný přes `npx` s API tokenem z `/settings/api-tokens` (viz README repozitáře).
Takový `.mcp.json` obsahuje token, nedávej ho do gitu.
