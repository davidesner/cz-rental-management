# Changelog

Verzování dle [semver](https://semver.org/):
- **patch** (`0.1.x`): bug fix, drobná oprava textu v existujících souborech
- **minor** (`0.x.0`): nová funkce / sub-skill / command zachovávající stávající workflow
- **major** (`x.0.0`): breaking change ve workflow nebo schema (např. přesun template do DB)

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
