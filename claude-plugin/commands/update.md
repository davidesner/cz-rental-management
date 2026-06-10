---
description: Sync lokálního rental-management workflow skillu s aktuální template verzí z pluginu — detekuje změny v template, nabídne merge per soubor. Zachovává properties/ a fixtures/.
---

# Update: Merge template changes do lokálního rental-management skillu

Synchronizuje **template** (`<plugin>/templates/skill/`) s **lokálním user-owned skill** (typicky `~/.claude/skills/rental-management/`). User-owned data (`properties/`, `fixtures/`) zůstanou nedotčená — měníme jen template-owned files.

## Step 1: Identifikuj cesty

**Template path** = `<this-plugin>/templates/skill/` — relativní k tomuto SKILL.md, dvě úrovně nahoru a do `templates/skill/`.

**Local skill path** — zeptej se user, default `~/.claude/skills/rental-management/`. Pokud user dříve nainstaloval jinam, zkontroluj existenci tam.

Pokud target neexistuje → "Skill ještě neni nainstalován. Spusť nejdřív `init`."

## Step 2: Klasifikuj soubory

Projdi rekurzivně oba adresáře a klasifikuj každý soubor podle cesty:

**Template-owned** (kandidáti pro update):
- `SKILL.md` (root)
- `README.md` (root, pokud existuje)
- `scripts/<file>` kde se soubor jmenuje stejně jako v template (shared scripts)

**User-owned** (NIKDY netýkat):
- Vše v `properties/**`
- Vše v `fixtures/**`
- `.skillmeta.json`, `.template-version`
- `scripts/<file>` co je JEN v lokálu, NE v template (user-specific shared script)

## Step 3: Spočítej diff

Pro každý template-owned soubor:

| Stav | Akce |
|---|---|
| Soubor je v template i v lokálu, **obsah shodný** | Skip (nic na práci) |
| Soubor je v template, v lokálu **chybí** | Nabídni **add** |
| Soubor je v template i v lokálu, **liší se** | Nabídni **diff review** → user vybere merge mode |
| Soubor je v lokálu, v template **chybí** | Skip (může být user-owned customization) |

## Step 4: Zobraz souhrn

```
Detekované změny v template oproti lokálu:

📝 Změněno:
  - SKILL.md  (template novější o 23 řádek, lokál upraven o 5 řádků)

➕ Nové v template:
  - scripts/compute_proration.py
  - scripts/parse_bank_csv.py

✅ Beze změn:
  - (nic)

🔒 Zachováno (user-owned):
  - properties/<slug-a>/README.md
  - properties/<slug-a>/electricity_parser.py
  - properties/<slug-b>/* (3 soubory)
  - fixtures/* (5 souborů)

Co chceš dělat?
```

## Step 5: Per-soubor řešení

Pro každý změněný/nový soubor zeptej se separátně:

**Změněné soubory:**
- "Ukázat diff" → spusť `diff -u <template> <local>` a zobraz user
- Nabídni:
  - **(a) Overwrite** — zkopíruj template přes lokál (ztratí lokální úpravy v tom souboru)
  - **(b) Merge ručně** — vytvoř `<file>.template-new` vedle lokálu, user si pak sám smerguje (např. v editoru)
  - **(c) Skip** — nech jak je, žádná akce

**Nové soubory:**
- "Ukázat obsah" — krátký peek (prvních 30 řádků)
- Nabídni:
  - **(a) Add** — zkopíruj template do lokálu
  - **(b) Skip** — nech být

Vždy potvrď před aktuálním zápisem.

## Step 6: Update `.template-version` marker

Po úspěšném merge ulož `<local>/.template-version`:
```json
{
  "syncedAt": "2026-06-09T14:30:00Z",
  "pluginPath": "/path/to/plugin",
  "pluginVersion": "0.1.0"
}
```

Příští run může tohle porovnat s `<plugin>/.claude-plugin/plugin.json#version` — pokud shoda, "Nic k update", a žádný diff scan není potřeba.

## Step 7: Report

Shrni co se updatovalo:
```
Hotovo. Synchronizováno:
  ✓ SKILL.md — overwritten (template v0.1.0 → lokál)
  ✓ scripts/compute_proration.py — added
  ⊘ scripts/parse_bank_csv.py — skipped (user choice)

Nedotčeno:
  - properties/* (5 souborů)
  - fixtures/* (3 soubory)
```

## Safety

- **NIKDY** nedělej batch overwrite bez explicitního per-soubor potvrzení
- **NIKDY** se nedotýkat `properties/` ani `fixtures/`
- **Ukaž diff** než píšeš
- Pokud user řekne "skip all", respektuj — žádný silent merge
- Při overwrite nabídni vytvořit backup `<file>.bak-<timestamp>` před zápisem (volitelně)

## Edge cases

- **Plugin path není detekovatelný** (skill běží mimo plugin context) — zeptej se user na cestu k pluginu, nebo `git pull` nemůže být relativně k tomuto SKILL.md
- **User má v lokálu úpravy shared scriptu** který v template chybí → considered user-owned, nedotýkat se
- **Konflikty** (template změnil řádky které user taky lokálně upravil) → vždy nabídni manual merge (option b), nikdy auto-merge bez review
