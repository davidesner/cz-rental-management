---
description: Roční vyúčtování pronájmu pro nájemníka — parsuje SVJ vyúčtování, faktury za elektřinu, bankovní výpisy; spočítá adjustmenty (FO odečet, solar credit); zapíše přes MCP. Aktivuj když user řekne "vyúčtování", "rozpočítat nájem", "process bills", "spočítej <property-name-a>" apod.
---

# Rental Management Reconciliation

Workflow pro roční vyúčtování pronájmu. Předpokládá MCP server `rental-management` připojený (poskytuje `properties_list`, `record_payments`, `create_cost_statement`, `compute_reconciliation`, atd.).

## Když začínáš

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
2. **Zapiš základ** — adresa, nájemník, SVJ, fond oprav složení, jakákoli zvláštní pravidla (např. solar)
3. **Pro každý typ dokumentu** (SVJ vyúčtování, elektřina, bank statement):
   - Požádej user o ukázku
   - Pochop strukturu, ukaž extraction draft, počkej na confirm
   - Pokud parsing potřebuje Python (PDF tabulky, OCR, …), napiš `properties/<slug>/<source>_parser.py`
   - Pro deterministické výpočty (solar credit, FO odečet, proporce) napiš `properties/<slug>/compute_<source>.py`
4. **Po úspěšném draft reconciliation** se zeptej user: "Mám uložit tyhle parsery + pravidla pro příště?"
5. **Pokud yes**: zapiš parsery, případně `properties/<slug>/fixtures/<year>-<source>.{input,expected}.json` (pro regression)

## Computation guard

**LLM NIKDY nepočítá v hlavě.** Pro každou aritmetiku (součet, násobení, proporce) volej Python skript v `scripts/` nebo `properties/<slug>/`.

Pokud skript neexistuje a potřebuješ matiku → napiš ho jako deterministický Python (krátký, čistý, otestovatelný).

## Konvence (kam co dát)

- `scripts/` — sdílené Python skripty napříč properties (vytvoř pouze když se pattern opakuje pro 2+ properties)
- `properties/<slug>/README.md` — **povinné, vždy** — popis property, parsing notes, pravidla, FO breakdown, sazby
- `properties/<slug>/*.py` — **pouze když je potřeba** (negeneruj prázdné placeholdery)
- `properties/<slug>/fixtures/` — jakmile máš parser/compute, ulož sample input + expected output pro regression

## Workflow ročního vyúčtování

1. **Sběr dokumentů** — SVJ vyúčtování PDF, faktury elektřina, bank statement za období
2. **Parse** — generic extractory (volný text → JSON) nebo property-specific parsery
3. **Compute** — Python skripty pro adjustmenty (solar, FO odečet, proporce)
4. **Regression test** — pokud `properties/<slug>/fixtures/` existují, spusť je proti current parsery; **fail = STOP a oznam user**
5. **MCP zápis** (idempotentní přes `externalId` / `documentRef`):
   - `record_payments` (z bank statementu, s SHA hash jako externalId)
   - `create_cost_statement` per dokument (SVJ, elektřina, …) s `totalAmount` + signed `adjustmentAmount`
6. **Audit trail** — vždy doplň lidsky čitelný `adjustmentNote` (např. "FO portion 1424+110+85+213+46 = 1878 Kč/měs × 103/365 dní = 6253 Kč")
7. **Compute reconciliation** přes MCP `compute_reconciliation`
8. **Prezentuj user** breakdown (per kind: paid vs cost vs diff) + celkový rozdíl
9. **Počkej na confirm** než navrhneš `finalize`

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
