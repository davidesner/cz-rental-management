---
name: rocni-vyuctovani
description: Roční vyúčtování pronájmu pro nájemníka — parsuje SVJ vyúčtování, faktury za elektřinu, bankovní výpisy; spočítá adjustmenty (FO odečet, solar credit); zapíše přes MCP. Aktivuj když user řekne "vyúčtování", "rozpočítat nájem", "process bills", "spočítej <property name>" apod.
---

# Rental Management Reconciliation

Workflow pro roční vyúčtování pronájmu. Předpokládá MCP server `rental-management` připojený (poskytuje `properties_list`, `record_payments`, `create_cost_statement`, `compute_reconciliation`, atd.).

## Když začínáš

**Sister skill — smlouvy**: pokud user požaduje vyrobit/reformat smlouvu nebo dodatek, použij skill `smlouvy` (workflow A — learn template z existujícího PDF/DOCX, workflow B — render z uložené šablony + dat z MCP). Vyúčtování a smlouvy mohou koexistovat ve stejné konverzaci.

1. **Najdi pracovní složku** — kořen s `AGENTS.md`, který popisuje strukturu (typicky cwd nebo některý z jeho rodičů). Pokud ho nenajdeš, zeptej se user na cestu; pokud složka ještě neexistuje, nasměruj ho na skill `init`.
2. **Přečti `AGENTS.md`** — obsahuje konvence a mapping název nemovitosti → složka.
3. **Identifikuj property**:
   - Z user promptu (jméno nemovitosti)
   - Nebo přes MCP `properties_list` a zeptej se user
4. **Resolvuj složku**:
   - Pokud `AGENTS.md` má explicitní mapping pro tuhle property, použij ho
   - Jinak default konvence: složka se jmenuje jako slug (property name kebab-cased, např. "<Property Name>" → `<property-name>`)
   - Kde se mapping a konvence liší, **platí mapping**
5. **Hledej `<složka>/_agent/`**:
   - **Pokud existuje**: čti `<složka>/_agent/README.md`, použij tamní parsery a pravidla
   - **Pokud ne**: vstoupíš do **learning mode** (níže)

## Learning mode (nová property)

Když property folder neexistuje:

1. **Vytvoř** `<složka>/_agent/` a v ní `README.md`
2. **Zapiš metodiku** — viz [Co patří / nepatří do property README](#co-patří--nepatří-do-property-readme) níže
3. **Pro každý typ dokumentu** (SVJ vyúčtování, elektřina, bank statement):
   - Požádej user o ukázku
   - Pochop strukturu, ukaž extraction draft, počkej na confirm
   - Pokud parsing potřebuje Python (PDF tabulky, OCR, …), napiš `<složka>/_agent/<source>_parser.py`
   - Pro deterministické výpočty (solar credit, FO odečet, proporce) napiš `<složka>/_agent/compute_<source>.py`
4. **Po úspěšném draft reconciliation** se zeptej user: "Mám uložit tyhle parsery + pravidla pro příště?"
5. **Pokud yes**: zapiš parsery, případně `<složka>/_agent/fixtures/<year>-<source>.{input,expected}.json` (pro regression)

## Co patří / nepatří do property README

Property README je **metodický dokument** (recept na vyúčtování), ne snapshot stavu. Měl by být čitelný i za rok bez úprav.

**Patří tam:**
- MCP identifikátory (`propertyId`, `contractId`) — stabilní reference do platformy
- Adresa a obecná identifikace nemovitosti
- Zdroje dokumentů a jejich struktura (např. "správce posílá Detail + Přehled PDF; byt a garáž na stejném VS")
- Speciální pravidla **jako koncept** ("FO odečet je část SVJ záloh, kterou nese vlastník; výpočet `monthly_deductible × 12 × proporce`")
- Pointery na parsery, fixtures, podklady
- Workflow/postup specifický pro tuhle property (např. "garáž má vlastní VS")

**NEPATŘÍ tam:**
- Konkrétní částky/sazby (např. FO odečet měsíčně, sazba za kWh solární energie, nájemné) — **mění se v čase, jsou v MCP nebo v podkladech daného roku**
- Jména nájemců, čísla účtů — v MCP (`tenants_get`, `contracts_get`)
- Datumy kontraktu, auto-renewal historie — v MCP (`contracts_get`)
- Snapshoty minulých reconciliations (např. "Backfill 2024 — výsledek +XYZ Kč") — v MCP (`reconciliations_list`)
- MCP IDs konkrétních cost_statements / plateb z minulých let
- Hodnoty z jednotlivých faktur (čísla faktur, kWh) — v podkladech

**Heuristika:** pokud informaci najdeš přes MCP volání nebo v podkladu daného roku, do README nepatří. README říká **jak to spočítat**, ne **co to konkrétně bylo**.

## Computation guard

**LLM NIKDY nepočítá v hlavě.** Pro každou aritmetiku (součet, násobení, proporce) volej Python skript ze `scripts/` v tomto skillu nebo z `<složka>/_agent/`.

Pokud skript neexistuje a potřebuješ matiku → napiš ho jako deterministický Python (krátký, čistý, otestovatelný).

## Konvence (kam co dát)

- `scripts/generate_reconciliation_pdf.py` — generic 5-stránkový PDF (souhrn + per-kind sheets + payment instruction), spouští se jako CLI z tohoto skillu — viz krok 10 workflow.
- `<složka>/_agent/README.md` — **povinné, vždy** — metodika (parsing notes, koncept pravidel). NE specifické sazby/jména/datumy — viz sekce výše.
- `<složka>/_agent/*.py` — **pouze když je potřeba** (negeneruj prázdné placeholdery). Sazby a hodnoty čti z parametrů / MCP, nehardcoduj.
- `<složka>/_agent/pdf-<rok>.json` — data pro PDF daného roku (hodnoty z MCP a podkladů, ne hardcoded sazby). Schema viz `scripts/example-pdf-data.json` v tomto skillu.
- `<složka>/_agent/fixtures/` — jakmile máš parser/compute, ulož sample input + expected output pro regression. Per-year snapshoty (input + expected reconciliation result) jsou OK — fixují stav v čase, neslouží jako reference pro budoucí výpočty.

## Workflow ročního vyúčtování

1. **Sběr dokumentů** — SVJ vyúčtování PDF, faktury elektřina, bank statement za období
2. **Parse** — generic extractory (volný text → JSON) nebo property-specific parsery
3. **Compute** — Python skripty pro adjustmenty (solar, FO odečet, proporce)
4. **Validace před zápisem do MCP** — všechny kontroly musí projít, jinak **STOP a oznam user**:
   - **Kontrolní součet parsu:** součet naparsovaných položek se rovná celkové částce vytištěné na dokladu. Když nesedí, parser řádek vynechal nebo přečetl špatně.
   - **Řád částek:** porovnej per-kind totaly s minulým rokem (`reconciliations_list`). Skok o řád znamená záměnu haléřů a korun.
   - **Zálohy proti smlouvě:** `contract_terms_list` se musí shodovat s podepsanou smlouvou v `najem/`. MCP se od papíru rozchází tiše a vyúčtování pak počítá se špatnou zálohou.
   - **Regression:** pokud `<složka>/_agent/fixtures/` existují, spusť je proti current parseru.
5. **MCP zápis** (idempotentní přes `externalId` / `documentRef`):
   - `record_payments` (z bank statementu, s SHA hash jako externalId)
   - **Zkontroluj response** — `record_payments` může vrátit i `duplicates`, ne jen `created`/`existing`:
     - `existing` = shoda podle `externalId` (stejný záznam, poslaný znovu) — idempotentní no-op, nic neříkej
     - `duplicates` = shoda podle smlouvy + částky + data, ale JINÉ `externalId` — tuhle platbu už zapsal jiný kanál (nejspíš aktivní bank integrace). `duplicates` a `existing` neplet dohromady, znamenají různé věci.
     - Import ze statementu tím nepřestává být správný krok — je teď navíc bezpečný, protože systém duplicitu odmítne místo aby ji založil znovu. Neruš tenhle krok, jen **řekni user, které řádky se přeskočily a proč** (že daná platba je už evidovaná odjinud) — to je informace, kterou potřebuje, ne chyba k opravě
   - `create_cost_statement` per dokument (SVJ, elektřina, …) s `totalAmount` + signed `adjustmentAmount`
6. **Audit trail** — vždy doplň lidsky čitelný `adjustmentNote` ukazující výpočet (proměnné, vzorec, výsledek). Tyto poznámky v MCP slouží jako důkaz proti podkladu — README říká jak, MCP zachycuje co.
7. **Compute reconciliation** přes MCP `compute_reconciliation`
8. **Prezentuj user** breakdown (per kind: paid vs cost vs diff) + celkový rozdíl
9. **Počkej na confirm** než navrhneš `finalize`
10. **Generuj PDF pro nájemce** — naplň `<složka>/_agent/pdf-<rok>.json` podle schematu v `scripts/example-pdf-data.json` a spusť generátor z tohoto skillu:

    ```bash
    python3 <cesta-k-tomuto-skillu>/scripts/generate_reconciliation_pdf.py \
        --data <složka>/_agent/pdf-<rok>.json \
        --out  <složka>/vyuctovani/<rok>/
    ```

    Cestu ke skriptu si odvoď od umístění tohoto `SKILL.md`, nehardcoduj ji.

11. **Zkontroluj vygenerované PDF** — nájemce dostane tenhle soubor, ne MCP. Vytáhni z něj text a **každou částku porovnej s `reconciliations_get`**:

    ```bash
    pdftotext -layout <pdf> - | grep -nE "Kč|CZK"
    ```

## Period matching pravidlo

Reconciliation matchuje platby a náklady per kind podle pravidla:

1. Pro každý kind najdi cost statementy, jejichž `periodFrom` startuje uvnitř reconciliation období (`reconFrom <= cs.periodFrom <= reconTo`)
2. `matchPeriod` pro kind = union jejich period (`min(periodFrom)` → `max(periodTo)`)
3. Pokud žádný cost statement nesplňuje → matchPeriod = reconciliation period (default)
4. Pro rent (žádný cost statement existuje) → matchPeriod = vždy default

Tato logika umožňuje různé cykly per kind (např. SVJ kalendářní rok + elektřina Feb-Feb).

### Auto-shift při overlap mezi po sobě jdoucími cycle statementy

Když máš více statementů stejného druhu (např. roční PRE pro elektřinu několik let za sebou), boundary měsíc mezi dvěma cycle statementy by se jinak počítal dvakrát (jednou v každém reconciliation). Calc to řeší automaticky:

**Pravidlo**: pokud PŘEDCHOZÍ statement stejného druhu/property končí ve stejném kalendářním měsíci jako start aktuálního statementu, aktuální matchPeriod se posune o měsíc dopředu (boundary měsíc "vlastní" předchozí statement).

**Příklad** (elektřina s ročním Feb-Feb cyklem):
- Statement A: `2024-02-15 → 2025-02-14` → 2024 recon, matchPeriod **Feb 2024 - Feb 2025** (13 měsíců, no prior)
- Statement B: `2025-02-15 → 2026-02-14` → 2025 recon, matchPeriod **Mar 2025 - Feb 2026** (12 měsíců, prior A končí v Feb 2025 → shift)
- Feb 2025 je zahrnut JEN v 2024 recon (A), ne v 2025 recon (B) → **žádný double-count**

**V UI**: posunutý matchPeriod má amber ⓘ tooltip s vysvětlením "měsíc už pokrývá předchozí vyúčtování".

**Co dělat user-side**: zachovat původní periodu z faktury (Feb 15 - Feb 14) — calc shift udělá za tebe. Žádná manuální úprava cost statementu.

**Gaps fungují**: pokud mezi statementy je mezera (např. A končí Dec 2024, C startuje Feb 2026), shift se neaplikuje (boundary měsíce se nedotýkají).

### Alternativy (pokud nechceš spoléhat na shift)

- **Month-aligned period**: zaokrouhli na celé měsíce (např. Mar 1 → Feb 28 místo Feb 15 → Feb 14). Cost upravit pokud chceš proporcionálně, nebo nechat jak je faktura (drobná nepřesnost ~1 den).
- **Proporcionální split na 2 statementy** (jeden per kalendářní rok):
  - Statement A: 2024-02-15 → 2024-12-31 (cost = `total × (321/366)`)
  - Statement B: 2025-01-01 → 2025-02-14 (cost = `total × (45/366)`)
  - Adjustmenty rozděl analogicky
  - Vhodné když potřebuješ strict per-rok matching i pro nákladovou hodnotu (ne jen měsíce platby)

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
3. Piš do `<složka>/_agent/...` v pracovní složce
4. Po zápisu spusť regression (pokud fixtures existují) jako sanity check

## Tipy pro Python skripty

- Použij standardní knihovny pokud možno (`csv`, `json`, `decimal`)
- Pro PDF: `pdfplumber` (lepší pro tabulky) nebo `pypdf`
- Pro CSV/Excel: `pandas` jen pokud je to opravdu potřeba (jinak `csv`)
- Money v haléřích jako `int` (Decimal × 100), nikdy float
- Každý compute skript ber **JSON input + JSON output** (stdin/stdout nebo argv) — snadno testovatelné

## Zúčtovací období a lhůty (zák. č. 67/2013 Sb.)

| co | § | lhůta |
|---|---|---|
| zúčtovací období | 2 | max. 12 měsíců, počátek určuje poskytovatel |
| doručit vyúčtování | 7 odst. 1 | 4 měsíce od konce období |
| finanční vyrovnání | 7 odst. 3 | ujednaná, max. 4 měsíce od doručení |
| doložit náklady na žádost | 8 | do 5 měsíců po konci období, vyhovět do 30 dnů |
| pokuta za prodlení | 13 | 50 Kč za každý započatý den |

**Zúčtovací období volí tak, aby lhůta 4 měsíců vyšla** — prodloužit ji smlouvou
nejde. § 7 odst. 1 vyhrazuje výjimku jinému právnímu předpisu, ne dohodě stran;
metodický pokyn MMR: *„Ustanovení § 7 je kogentní."* Klauzuli „vyúčtování do 30
dnů od obdržení podkladů od SVJ" u nájmu bytu navíc smete § 2235 odst. 1 OZ.

**Rozdílné zúčtovací období pro každou službu je legální.** MMR: *„ZS nebrání ani
možnosti určit pro jednotlivé služby rozdílný počátek, popř. délku zúčtovacího
období."* Výčet služeb v § 3 odst. 1 je demonstrativní a rozsah se určuje
ujednáním, takže sem spadá i elektřina odebíraná na smlouvu pronajímatele. Jeden
souhrnný dokument zákon nežádá.

Využij toho: službu dej na období, jehož konec lhůtu stíháš (typicky elektřinu na
fakturační rok dodavatele) a doruč vyúčtování zvlášť, jakmile dorazí jeho podklad.

**Když podklad chodí později než za 4 měsíce** (typicky SVJ), žádná volba období
to nevyřeší. Pokuta podle § 13 vzniká uplynutím lhůty automaticky, ale neuplatní
se, kdyby nebylo spravedlivé včasné plnění požadovat — a **prodlení dodavatele nad
pronajímatelem sem spadá**. Archivuj proto písemné urgence, to je ten důkaz.

## Rozpad předpisu SVJ na osobu vs. na byt

**Sazbu na osobu ověř na korunu:** přepočtem na jiný počet osob musí vyjít jiná
známá částka. Když nevyjde, položka, kterou máš za „na byt", má složku na osobu.
Skladba položek se liší podle SVJ.

Zálohu na vodu porovnej se skutečností z posledního vyúčtování, bývá
podhodnocená. Odchylku od předpisu SVJ zdůvodni v `note` u `contract_terms_add`.
