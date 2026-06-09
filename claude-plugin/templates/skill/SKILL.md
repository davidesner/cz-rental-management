---
description: Roční vyúčtování pronájmu pro nájemníka — parsuje SVJ vyúčtování, faktury za elektřinu, bankovní výpisy; spočítá adjustmenty (FO odečet, solar credit); zapíše přes MCP. Aktivuj když user řekne "vyúčtování", "rozpočítat nájem", "process bills", "spočítej <property-name-a>" apod.
---

# Rental Management Reconciliation

Workflow pro roční vyúčtování pronájmu. Předpokládá MCP server `rental-management` připojený (poskytuje `properties_list`, `record_payments`, `create_cost_statement`, `compute_reconciliation`, atd.).

## Když začínáš

**0. Check template updates** (rychlá kontrola, ~2s):

Tento skill je lokální kopie šablony z `rental-management` pluginu. Než začneš workflow, ověř že parent plugin nemá novější verzi šablony:

- Pokud existuje `.template-version` v této skill složce, porovnej s `<plugin>/.claude-plugin/plugin.json#version`
- Pokud plugin novější → upozorni user: "Plugin má novější template verzi (X → Y). Spusť `/rental-management:update` před pokračováním?" — počkej na user rozhodnutí
- Pokud `.template-version` neexistuje (skill nikdy nesynchronizován) → upozorni jednou stejně
- Pokud verze shodují / plugin path nedetekovatelný → pokračuj bez upozornění

Tato kontrola se dělá **jednou na začátku konverzace**, ne před každou MCP operací.

1. **Identifikuj property**:
   - Z user promptu (jméno nemovitosti)
   - Nebo přes MCP `properties_list` a zeptej se user
2. **Slug** = property name kebab-cased (např. "<property-name-a>" → `property-slug-a`)
3. **Hledej `properties/<slug>/`** v této skill složce (tj. relativně k tomuto SKILL.md):
   - **Pokud existuje**: čti `properties/<slug>/README.md`, použij tamní parsery a pravidla
   - **Pokud ne**: vstoupíš do **learning mode** (níže)

## Learning mode (nová property)

Když property folder neexistuje:

1. **Vytvoř** `properties/<slug>/` a v ní `README.md`
2. **Zapiš metodiku** — viz [Co patří / nepatří do property README](#co-patří--nepatří-do-property-readme) níže
3. **Pro každý typ dokumentu** (SVJ vyúčtování, elektřina, bank statement):
   - Požádej user o ukázku
   - Pochop strukturu, ukaž extraction draft, počkej na confirm
   - Pokud parsing potřebuje Python (PDF tabulky, OCR, …), napiš `properties/<slug>/<source>_parser.py`
   - Pro deterministické výpočty (solar credit, FO odečet, proporce) napiš `properties/<slug>/compute_<source>.py`
4. **Po úspěšném draft reconciliation** se zeptej user: "Mám uložit tyhle parsery + pravidla pro příště?"
5. **Pokud yes**: zapiš parsery, případně `properties/<slug>/fixtures/<year>-<source>.{input,expected}.json` (pro regression)

## Co patří / nepatří do property README

Property README je **metodický dokument** (recept na vyúčtování), ne snapshot stavu. Měl by být čitelný i za rok bez úprav.

**Patří tam:**
- MCP identifikátory (`propertyId`, `contractId`) — stabilní reference do platformy
- Adresa a obecná identifikace nemovitosti
- Zdroje dokumentů a jejich struktura ("<svj-name> posílá Detail + Přehled PDF; byt a garáž na stejném VS")
- Speciální pravidla **jako koncept** ("FO odečet je část SVJ záloh, kterou nese vlastník; výpočet `monthly_deductible × 12 × proporce`")
- Pointery na parsery, fixtures, podklady
- Workflow/postup specifický pro tuhle property (např. "garáž má vlastní VS")

**NEPATŘÍ tam:**
- Konkrétní částky/sazby (FO <amount>/měs, solar <rate> Kč/kWh, nájem <amount>) — **mění se v čase, jsou v MCP nebo v podkladech daného roku**
- Jména nájemců, čísla účtů — v MCP (`tenants_get`, `contracts_get`)
- Datumy kontraktu, auto-renewal historie — v MCP (`contracts_get`)
- Snapshoty minulých reconciliations ("Backfill 2024 — výsledek +693 Kč") — v MCP (`reconciliations_list`)
- MCP IDs konkrétních cost_statements / plateb z minulých let
- Hodnoty z jednotlivých faktur (čísla faktur, kWh) — v podkladech

**Heuristika:** pokud informaci najdeš přes MCP volání nebo v podkladu daného roku, do README nepatří. README říká **jak to spočítat**, ne **co to konkrétně bylo**.

## Computation guard

**LLM NIKDY nepočítá v hlavě.** Pro každou aritmetiku (součet, násobení, proporce) volej Python skript v `scripts/` nebo `properties/<slug>/`.

Pokud skript neexistuje a potřebuješ matiku → napiš ho jako deterministický Python (krátký, čistý, otestovatelný).

## Konvence (kam co dát)

- `scripts/` — sdílené Python skripty napříč properties (vytvoř pouze když se pattern opakuje pro 2+ properties)
- `properties/<slug>/README.md` — **povinné, vždy** — metodika (parsing notes, koncept pravidel). NE specifické sazby/jména/datumy — viz sekce výše.
- `properties/<slug>/*.py` — **pouze když je potřeba** (negeneruj prázdné placeholdery). Sazby a hodnoty čti z parametrů / MCP, nehardcoduj.
- `properties/<slug>/fixtures/` — jakmile máš parser/compute, ulož sample input + expected output pro regression. Per-year snapshoty (input + expected reconciliation result) jsou OK — fixují stav v čase, neslouží jako reference pro budoucí výpočty.

## Workflow ročního vyúčtování

1. **Sběr dokumentů** — SVJ vyúčtování PDF, faktury elektřina, bank statement za období
2. **Parse** — generic extractory (volný text → JSON) nebo property-specific parsery
3. **Compute** — Python skripty pro adjustmenty (solar, FO odečet, proporce)
4. **Regression test** — pokud `properties/<slug>/fixtures/` existují, spusť je proti current parsery; **fail = STOP a oznam user**
5. **MCP zápis** (idempotentní přes `externalId` / `documentRef`):
   - `record_payments` (z bank statementu, s SHA hash jako externalId)
   - `create_cost_statement` per dokument (SVJ, elektřina, …) s `totalAmount` + signed `adjustmentAmount`
6. **Audit trail** — vždy doplň lidsky čitelný `adjustmentNote` ukazující výpočet (proměnné, vzorec, výsledek). Tyto poznámky v MCP slouží jako důkaz proti podkladu — README říká jak, MCP zachycuje co.
7. **Compute reconciliation** přes MCP `compute_reconciliation`
8. **Prezentuj user** breakdown (per kind: paid vs cost vs diff) + celkový rozdíl
9. **Počkej na confirm** než navrhneš `finalize`

## Period matching pravidlo

Reconciliation matchuje platby a náklady per kind podle pravidla:

1. Pro každý kind najdi cost statementy, jejichž `periodFrom` startuje uvnitř reconciliation období (`reconFrom <= cs.periodFrom <= reconTo`)
2. `matchPeriod` pro kind = union jejich period (`min(periodFrom)` → `max(periodTo)`)
3. Pokud žádný cost statement nesplňuje → matchPeriod = reconciliation period (default)
4. Pro rent (žádný cost statement existuje) → matchPeriod = vždy default

Tato logika umožňuje různé cykly per kind (např. SVJ kalendářní rok + elektřina Feb-Feb).

### Prevence problémů

**Pokud cost statement crossuje year boundary** (např. PRE Feb 2024 - Feb 2025), můžeš zvolit:

- (a) **Nechat tak** — statement startuje v jednom roce (2024), automaticky patří k tomu recon (2024). MatchPeriod pro elektřinu = Feb-Feb. Platby matchovány v té periodě. Druhý rok (2025) recon nedostane žádný statement co tam nepatří, použije default.

- (b) **Proporcionální split na 2 statementy** — pokud chceš strict kalendářní rok matching, rozděl jeden cycle statement na dva:
  - Statement A: 2024-02-15 → 2024-12-31 (cost = `total × (321/366)`)
  - Statement B: 2025-01-01 → 2025-02-14 (cost = `total × (45/366)`)
  - Adjustmenty rozděl analogicky
  - Každý belongs k svému kalendářnímu roku reconciliace
  - **Pro klientskou stranu lepší pokud chceš predictable calendar-year matching**

Volba mezi (a) a (b) je per-property metodika — doporuč user vybrat jednu a držet se jí.

### Ukaž user period preview

Před `compute_reconciliation` volej `cost_statements_list` pro property a předznám user co se bude dít:

```
"Pro tuto reconciliaci vidím:
 • SVJ: 1 statement period 2024-01-01 → 2024-12-31
 • Elektřina: 1 statement period 2024-02-15 → 2025-02-14
 → Matching pro elektřinu bude Feb 2024 - Feb 2025 (cycle)
 OK?"
```

## Self-update

Když user řekne "ulož parser" / "ulož pravidlo":
1. **Ukaž diff/preview** přesně čeho se zápis dotkne
2. **Počkej na explicitní "ano"** (nikdy ne implicitně)
3. Piš do `properties/<slug>/...` v této skill složce — **nikdy** ne do nějakého upstream/plugin místa
4. Po zápisu spusť regression (pokud fixtures existují) jako sanity check

## Tipy pro Python skripty

- Použij standardní knihovny pokud možno (`csv`, `json`, `decimal`)
- Pro PDF: `pdfplumber` (lepší pro tabulky) nebo `pypdf`
- Pro CSV/Excel: `pandas` jen pokud je to opravdu potřeba (jinak `csv`)
- Money v haléřích jako `int` (Decimal × 100), nikdy float
- Každý compute skript ber **JSON input + JSON output** (stdin/stdout nebo argv) — snadno testovatelné
