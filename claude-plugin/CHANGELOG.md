# Changelog

Verzování dle [semver](https://semver.org/):
- **patch** (`0.1.x`): bug fix, drobná oprava textu v existujících souborech
- **minor** (`0.x.0`): nová funkce / sub-skill / command zachovávající stávající workflow
- **major** (`x.0.0`): breaking change ve workflow nebo schema (např. přesun template do DB)

## 1.0.1 — 2026-08-28

### Changed

- Formulace v `README.md` a ve všech třech `SKILL.md` popisují layout tak, jak je, místo aby ho vymezovaly proti dřívějšímu modelu s kopírováním šablony. Věty typu „nekopíruj do pracovní složky" nebo „nikdy do pluginu" zmizely — pro nového uživatele popisovaly situaci, která pro něj nikdy neexistovala. Historie přechodu zůstává v záznamu 1.0.0 níže, kam patří.

## 1.0.0 — 2026-08-28

### Changed — BREAKING

- **Plugin už nekopíruje šablonu skillu.** `templates/skill/` zrušeno; obsah se rozpadl na tři skilly v `skills/`: `rocni-vyuctovani`, `smlouvy`, `init`. Skilly žijí v pluginu v jediné kopii a aktualizují se s ním.
- **Znalost o nemovitosti se přestěhovala k dokumentům.** Metodika, parsery a fixtures nežijí v `~/.claude/skills/.../properties/<slug>/`, ale v `<nemovitost>/_agent/` v pracovní složce uživatele.
- **Rozlišení nemovitosti přes `AGENTS.md`.** Skill už neodvozuje `slug → properties/<slug>/`; čte mapping název → složka z `AGENTS.md` v kořeni pracovní složky. Default konvence zůstává „složka = slug", ale existující archiv se kvůli pluginu nemusí přejmenovávat.
- **PDF generátor je CLI entry point, ne knihovna.** Místo per-property `generate_pdf_<year>.py`, který importoval `build_pdf()` relativní cestou, se spouští `generate_reconciliation_pdf.py --data <json> --out <dir>` a nemovitost dodává jen data. Odstraňuje závislost na cestě do plugin cache, jejíž součástí je číslo verze.
- **Naučené Typst šablony a `INDEX.md`** se zapisují do `_agent/smlouvy/` v pracovní složce, ne do pluginu, kde je update přepisoval.

### Removed

- `commands/update.md` — merge šablony do lokální kopie. Není co mergovat.
- `.template-version` a kontrola verze šablony na začátku konverzace.
- Kroky „najdi template → zkopíruj → symlinkuj" z `commands/init.md`.

## 0.3.3 — 2026-08-22

### Changed
- `SKILL.md` krok 5 (MCP zápis): `record_payments` teď dokumentuje i `duplicates` v response, ne jen `existing`. Agent má zkontrolovat response a říct user, které řádky se přeskočily a proč — `duplicates` (jiné externalId, stejná platba už zapsaná jiným kanálem) je jiná věc než `existing` (stejné externalId, idempotentní re-run). Import zůstává správný krok, jen je teď bezpečnější — systém duplicitu odmítne místo aby ji založil znovu.

## 0.3.2 — 2026-06-11

### Changed
- Plugin README: `MCP backend` sekce dokumentuje že MCP server je teď publikovaný npm balíček `@esnerda/cz-rental-management-mcp` spouštěný přes `npx` — není potřeba clone rental-management repa. Doplněn ukázkový `.mcp.json` snippet.

## 0.3.1 — 2026-06-10

### Changed
- Příklady v `SKILL.md`, `contracts/SKILL.md`, `commands/update.md`, `README.md` přepsány na generické placeholdery (`<jmeno>`, `<adresa>`, `<unit-number>`, …) — šablona má smysl jako generic skeleton, ne konkrétní snapshot.
- `plugin.json` author email synced.

## 0.3.0 — 2026-06-10

### Added
- **Shared script `scripts/generate_reconciliation_pdf.py`** — reusable 5-stránkový PDF template pro roční vyúčtování pro nájemce (header + souhrn + per-kind sheets + payment instruction). Property scripts importují `build_pdf()` a předají `RECONCILIATION` dict; schema dokumentován v hlavičce souboru. Stack: `reportlab`.

### Changed
- Skill SKILL.md: konvence sekce rozšířena o popis `scripts/generate_reconciliation_pdf.py` + per-property pattern `properties/<slug>/generate_pdf_<year>.py`. Workflow ročního vyúčtování má krok 10 — "Generuj PDF pro nájemce".

## 0.2.0 — 2026-06-10

### Added
- **Contracts sub-skill** (`contracts/SKILL.md`) — generování smluv a dodatků přes Typst
  - Workflow A: learn template z existujícího PDF/DOCX dokumentu
  - Workflow B: render document z uložené šablony + dat z MCP (tenant, contract, terms, property)
  - Variables katalog `{{var.name}}` pro lease + amendment
  - Reference template `lease-cs.typ` jako starting point
  - INDEX.md mapování name → kind/jazyk/path
- Stack: Typst (kompilace), pandoc (DOCX→MD), poppler (preview)
- Init command updated s `brew install typst pandoc poppler` doporučením

### Changed
- Root SKILL.md zmiňuje sister contracts skill
- Skill "Period matching pravidlo" sekce rozšířena o auto-shift dokumentaci (matchPeriod posun při overlap s prior statementem) — viz reconciliation/core fix `bd98e52`

## 0.1.0 — 2026-06-09

### Added
- Init command (`/rental-management:init`) — bootstrap user-owned skill copy z plugin template
- Update command (`/rental-management:update`) — sync template změn do lokálního skillu (zachovává `properties/` a `fixtures/`)
- Workflow skill template (`templates/skill/SKILL.md`) — roční reconciliation pronájmu přes MCP backend
  - Per-property folder pattern (`properties/<slug>/README.md` + parsers + fixtures)
  - Period matching pravidlo + proportional split prevence
  - Self-update workflow pro ukládání parserů / pravidel
- Plugin marketplace bootstrap (local dev — symlink ze `~/LOCAL_PLUGINS/`)
