# Workspace-owned knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rozdělit `claude-plugin/` tak, aby plugin nesl jen postup (skilly) a pracovní složka jen znalost a data — bez kopírování, bez merge, bez verzovacího markeru.

**Architecture:** `templates/skill/` se rozpadá na tři skilly v `claude-plugin/skills/` (`rocni-vyuctovani`, `smlouvy`, `init`). Skilly jsou generické a předpokládají strukturu pracovní složky popsanou v `AGENTS.md`, který v ní leží. PDF generátor se obrací z knihovny na CLI entry point, kterému property dodá JSON data místo Python skriptu.

**Tech Stack:** Markdown skilly (Claude Code plugin), Python 3 + reportlab (PDF), stdlib `unittest` pro testy skriptu.

**Spec:** `docs/superpowers/specs/2026-08-28-workspace-owned-knowledge-design.md`

## Global Constraints

- Větev: `feat/workspace-owned-knowledge`. `main` je chráněný — mergovat přes PR, CI musí být zelená.
- Jména skillů **kebab-case** (`rocni-vyuctovani`, `smlouvy`, `init`). Podtržítko nikde.
- Změna v `claude-plugin/` **vyžaduje** bump `claude-plugin/.claude-plugin/plugin.json#version` + záznam v `claude-plugin/CHANGELOG.md`. Tady major → `1.0.0`.
- **Žádné reálné PII** v souborech pluginu — jména, adresy, částky jen jako `<placeholder>`.
- Obsah skillů je **česky** (navazuje na stávající styl).
- **Bez migrace a zpětné kompatibility.** Plugin se píše, jako by to tak bylo vždycky. Žádný upgrade path, žádná detekce starého layoutu.
- Peníze v PDF vrstvě jsou `Decimal` v korunách (ne haléře — to je konvence TS backendu, ne tohoto skriptu).
- Testy Pythonu běží lokálně přes `python3 -m unittest`; CI (`test`/`typecheck`/`build`) je TypeScript-only a tento skript nepokrývá.

---

### Task 1: Přeskládat adresáře pluginu

Čistě strukturální krok — přesuny a mazání, žádná změna obsahu souborů. Ta přijde v úlohách 2–5.

**Files:**
- Move: `claude-plugin/templates/skill/SKILL.md` → `claude-plugin/skills/rocni-vyuctovani/SKILL.md`
- Move: `claude-plugin/templates/skill/scripts/generate_reconciliation_pdf.py` → `claude-plugin/skills/rocni-vyuctovani/scripts/generate_reconciliation_pdf.py`
- Move: `claude-plugin/templates/skill/contracts/SKILL.md` → `claude-plugin/skills/smlouvy/SKILL.md`
- Move: `claude-plugin/templates/skill/contracts/templates/lease-cs.typ` → `claude-plugin/skills/smlouvy/templates/lease-cs.typ`
- Delete: `claude-plugin/commands/update.md`
- Delete: `claude-plugin/templates/` (celý zbytek — `contracts/templates/INDEX.md`, `properties/.gitkeep`, `scripts/.gitkeep`)

**Interfaces:**
- Produces: cesty `claude-plugin/skills/{rocni-vyuctovani,smlouvy}/` a `claude-plugin/skills/rocni-vyuctovani/scripts/generate_reconciliation_pdf.py`, na které se odkazují všechny další úlohy.

`INDEX.md` se maže záměrně: podle specu je user-owned a vzniká v pracovní složce jako `_agent/smlouvy/INDEX.md` (zakládá ho skill `init`, úloha 5).

- [ ] **Step 1: Napsat strukturální kontrolu, která teď selže**

```bash
cat > /tmp/check-layout.sh <<'SH'
#!/usr/bin/env bash
# Ověří layout pluginu podle specu. Exit 0 = OK.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1
fail=0
must_exist=(
  claude-plugin/skills/rocni-vyuctovani/SKILL.md
  claude-plugin/skills/rocni-vyuctovani/scripts/generate_reconciliation_pdf.py
  claude-plugin/skills/smlouvy/SKILL.md
  claude-plugin/skills/smlouvy/templates/lease-cs.typ
  claude-plugin/commands/init.md
)
must_not_exist=(
  claude-plugin/templates
  claude-plugin/commands/update.md
)
for p in "${must_exist[@]}"; do
  [ -e "$p" ] || { echo "CHYBÍ: $p"; fail=1; }
done
for p in "${must_not_exist[@]}"; do
  [ -e "$p" ] && { echo "MĚLO BÝT SMAZÁNO: $p"; fail=1; }
done
[ $fail -eq 0 ] && echo "layout OK"
exit $fail
SH
chmod +x /tmp/check-layout.sh
```

- [ ] **Step 2: Spustit a ověřit, že selže**

Run: `/tmp/check-layout.sh`
Expected: FAIL — vypíše `CHYBÍ: claude-plugin/skills/rocni-vyuctovani/SKILL.md` a další, exit 1.

- [ ] **Step 3: Provést přesuny a mazání**

```bash
cd "$(git rev-parse --show-toplevel)"
mkdir -p claude-plugin/skills/rocni-vyuctovani/scripts
mkdir -p claude-plugin/skills/smlouvy/templates
mkdir -p claude-plugin/skills/init

git mv claude-plugin/templates/skill/SKILL.md \
       claude-plugin/skills/rocni-vyuctovani/SKILL.md
git mv claude-plugin/templates/skill/scripts/generate_reconciliation_pdf.py \
       claude-plugin/skills/rocni-vyuctovani/scripts/generate_reconciliation_pdf.py
git mv claude-plugin/templates/skill/contracts/SKILL.md \
       claude-plugin/skills/smlouvy/SKILL.md
git mv claude-plugin/templates/skill/contracts/templates/lease-cs.typ \
       claude-plugin/skills/smlouvy/templates/lease-cs.typ

git rm -q claude-plugin/commands/update.md
git rm -rq claude-plugin/templates
```

- [ ] **Step 4: Spustit kontrolu znovu**

Run: `/tmp/check-layout.sh`
Expected: `layout OK`, exit 0.

(`claude-plugin/skills/init/` je zatím prázdný adresář — git ho nesleduje, `SKILL.md` do něj přibude v úloze 5. Kontrola ho proto neověřuje.)

- [ ] **Step 5: Commit**

```bash
git add -A claude-plugin
git commit -m "refactor(plugin): move templates/skill into skills/, drop update command"
```

---

### Task 2: PDF generátor jako CLI entry point

Dnes je skript knihovna: property soubor ho importuje přes `sys.path` a předá modulový `RECONCILIATION` dict. Nově je to entry point — data přijdou v JSON, výstupní adresář argumentem.

**Files:**
- Modify: `claude-plugin/skills/rocni-vyuctovani/scripts/generate_reconciliation_pdf.py` (blok `RECONCILIATION` na ř. 38–230; `if __name__ == "__main__":` na konci, ř. 634–635)
- Create: `claude-plugin/skills/rocni-vyuctovani/scripts/example-pdf-data.json`
- Test: `claude-plugin/skills/rocni-vyuctovani/scripts/test_generate_reconciliation_pdf.py`

**Interfaces:**
- Produces:
  - `load_reconciliation(path: Path) -> dict` — načte JSON, desetinná čísla převede na `Decimal`
  - `resolve_output_path(data: dict, out_dir: Path | None) -> Path` — spojí `out_dir` s `basename(data["output_path"])`; bez `out_dir` vrátí `output_path` beze změny
  - `build_pdf(R: dict) -> None` — beze změny signatury; nadále čte `R["output_path"]`
  - CLI: `python3 generate_reconciliation_pdf.py --data FILE.json [--out DIR]`
- Consumes: nic z předchozích úloh kromě cesty z úlohy 1.

**Proč `parse_float=Decimal`:** modulový dict používá `Decimal(...)` na 24 místech a `fmt_kc()` na Decimal spoléhá. `json.load()` by z `1234.00` udělal `float` a formátování částek by se rozešlo. `parse_int` schválně **nepřevádíme** — celá čísla v datech (indexy, počty sloupců) mají zůstat `int`.

- [ ] **Step 1: Napsat failing testy**

```python
# claude-plugin/skills/rocni-vyuctovani/scripts/test_generate_reconciliation_pdf.py
"""Testy loaderu a rozlišení výstupní cesty. Spusť: python3 -m unittest -v"""
import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from generate_reconciliation_pdf import load_reconciliation, resolve_output_path


def _write(tmpdir, payload):
    p = Path(tmpdir) / "data.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


class LoadReconciliationTest(unittest.TestCase):
    def test_desetinna_cisla_jsou_decimal(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write(td, {"result": {"amount_kc": 1234.50}})
            data = load_reconciliation(path)
            self.assertEqual(data["result"]["amount_kc"], Decimal("1234.50"))
            self.assertIsInstance(data["result"]["amount_kc"], Decimal)

    def test_cela_cisla_zustavaji_int(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write(td, {"sheets": [{"type": "services", "columns": 3}]})
            data = load_reconciliation(path)
            self.assertIsInstance(data["sheets"][0]["columns"], int)

    def test_decimal_prezije_i_vnoreny_v_seznamu(self):
        with tempfile.TemporaryDirectory() as td:
            path = _write(td, {"rows": [["Voda", 100.00], ["Teplo", 250.25]]})
            data = load_reconciliation(path)
            self.assertEqual(data["rows"][1][1], Decimal("250.25"))

    def test_chybejici_soubor_hlasi_srozumitelnou_chybu(self):
        with self.assertRaises(FileNotFoundError):
            load_reconciliation(Path("/nope/chybi.json"))


class ResolveOutputPathTest(unittest.TestCase):
    def test_out_dir_prebije_adresar_ale_zachova_jmeno(self):
        data = {"output_path": "puvodni/misto/Vyuctovani_2025.pdf"}
        got = resolve_output_path(data, Path("/cil/vyuctovani/2025"))
        self.assertEqual(got, Path("/cil/vyuctovani/2025/Vyuctovani_2025.pdf"))

    def test_bez_out_dir_zustava_output_path(self):
        data = {"output_path": "Vyuctovani_2025.pdf"}
        got = resolve_output_path(data, None)
        self.assertEqual(got, Path("Vyuctovani_2025.pdf"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Spustit testy a ověřit, že selžou**

Run: `cd claude-plugin/skills/rocni-vyuctovani/scripts && python3 -m unittest -v`
Expected: FAIL — `ImportError: cannot import name 'load_reconciliation'`

Testy importují celý modul, a ten má `reportlab` mezi importy na vrcholu. Když
místo toho spadne na `ModuleNotFoundError: No module named 'reportlab'`, nainstaluj
ho (`pip3 install reportlab`) a spusť znovu — teprve pak je selhání to očekávané.

- [ ] **Step 3: Vyjmout ukázkový dict do JSON**

Blok `RECONCILIATION = {...}` (ř. 38–230) ze skriptu **smazat** a jeho obsah přepsat do `example-pdf-data.json` — hodnoty `Decimal("0.00")` jako JSON čísla `0.00`, tuply `("Nemovitost:", "…")` jako pole `["Nemovitost:", "…"]`. Placeholdery (`<Property>`, `<name, address>`) zůstávají — je to ukázka, ne data.

```json
{
  "output_path": "Vyuctovani_<Property>_<Year>.pdf",
  "title": "ROČNÍ VYÚČTOVÁNÍ PRONÁJMU",
  "period_human": "1. ledna <YYYY> – 31. prosince <YYYY>",
  "footer_text": "Roční vyúčtování <YYYY> — <Property>, <Address>",
  "issued_at_human": "<dd. mm. yyyy>",
  "identification": [
    ["Nemovitost:", "<address + unit numbers>"],
    ["Pronajímatel:", "<name, address>"],
    ["Nájemce:", "<name(s) + responsibility note>"],
    ["Smlouva:", "<period + renewal note>"],
    ["VS SVJ:", "<variable symbol>"],
    ["Vystaveno:", "<date>"]
  ],
  "result": {
    "label_p1": "PŘEPLATEK NÁJEMCE",
    "amount_kc": 0.00,
    "subtitle_p1": "k vrácení nájemci na účet <acct>",
    "label_pN": "K vrácení nájemci"
  },
  "sheets": []
}
```

Zbytek klíčů (`sheets` s typy `services` / `electricity_monthly` / `payments`, `summary`, `notes`, `payment_instruction`) přenes 1:1 z původního dictu stejnou transformací.

- [ ] **Step 4: Doplnit loader a CLI**

Nahoru k importům přidat `import argparse`, `import json`, `import sys`. Na konec souboru místo dosavadního `if __name__ == "__main__": build_pdf(RECONCILIATION)`:

```python
# ---------- CLI ----------

def load_reconciliation(path):
    """Načti JSON s daty vyúčtování.

    Desetinná čísla → Decimal (fmt_kc na tom stojí). Celá čísla zůstávají int.
    """
    path = Path(path)
    with path.open(encoding="utf-8") as fh:
        return json.load(fh, parse_float=Decimal)


def resolve_output_path(data, out_dir):
    """Kam se PDF zapíše. --out přebije adresář, jméno souboru zůstává z dat."""
    output_path = Path(data["output_path"])
    if out_dir is None:
        return output_path
    return Path(out_dir) / output_path.name


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Vyrob PDF ročního vyúčtování z JSON dat."
    )
    parser.add_argument("--data", required=True, type=Path,
                        help="JSON s daty vyúčtování (schema: example-pdf-data.json)")
    parser.add_argument("--out", type=Path, default=None,
                        help="adresář pro výstup; jméno souboru bere z --data")
    args = parser.parse_args(argv)

    data = load_reconciliation(args.data)
    target = resolve_output_path(data, args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    data["output_path"] = str(target)
    build_pdf(data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Docstring souboru (ř. 3–7) přepsat — už se nekopíruje:

```
Reusable entry point. Použití:
1. Připrav JSON s daty (schema viz example-pdf-data.json)
2. Spusť: python3 generate_reconciliation_pdf.py --data <data.json> --out <adresář>
```

- [ ] **Step 5: Spustit testy a ověřit, že projdou**

Run: `cd claude-plugin/skills/rocni-vyuctovani/scripts && python3 -m unittest -v`
Expected: PASS, 6 testů.

- [ ] **Step 6: Ověřit CLI end-to-end na ukázkových datech**

Run:
```bash
cd claude-plugin/skills/rocni-vyuctovani/scripts
python3 generate_reconciliation_pdf.py --data example-pdf-data.json --out /tmp/pdftest
ls -la /tmp/pdftest/
```
Expected: vznikne `/tmp/pdftest/Vyuctovani_<Property>_<Year>.pdf`, na stdout `PDF vytvořeno: …`.
Pokud chybí `reportlab`: `pip3 install reportlab` a zopakovat.

- [ ] **Step 7: Commit**

```bash
git add claude-plugin/skills/rocni-vyuctovani/scripts
git commit -m "feat(pdf): drive generator from JSON data via CLI instead of import"
```

---

### Task 3: Přepsat `skills/rocni-vyuctovani/SKILL.md`

**Files:**
- Modify: `claude-plugin/skills/rocni-vyuctovani/SKILL.md` (165 ř.)

**Interfaces:**
- Consumes: CLI z úlohy 2 (`--data` / `--out`)
- Produces: konvence cest `<slug>/_agent/`, na které staví úlohy 4 a 5

Sekce, které zůstávají **beze změny** (nedotýkat se): *Learning mode*, *Co patří / nepatří do property README*, *Computation guard*, *Period matching pravidlo* včetně auto-shiftu, *Tipy pro Python skripty*.

- [ ] **Step 1: Přidat `name` do frontmatteru**

```yaml
---
name: rocni-vyuctovani
description: Roční vyúčtování pronájmu pro nájemníka — parsuje SVJ vyúčtování, faktury za elektřinu, bankovní výpisy; spočítá adjustmenty (FO odečet, solar credit); zapíše přes MCP. Aktivuj když user řekne "vyúčtování", "rozpočítat nájem", "process bills", "spočítej <property name>" apod.
---
```

- [ ] **Step 2: Smazat sekci „0. Check template updates"**

Smazat celý blok od `**0. Check template updates** (rychlá kontrola, ~2s):` po `Tato kontrola se dělá **jednou na začátku konverzace**, ne před každou MCP operací.` včetně. Sekce existovala jen kvůli kopírované šabloně.

Odkaz na sister skill hned pod ním přepsat z `contracts/SKILL.md` na jméno skillu:

```markdown
**Sister skill — smlouvy**: pokud user požaduje vyrobit/reformat smlouvu nebo dodatek, použij skill `smlouvy` (workflow A — learn template z existujícího PDF/DOCX, workflow B — render z uložené šablony + dat z MCP). Vyúčtování a smlouvy mohou koexistovat ve stejné konverzaci.
```

- [ ] **Step 3: Přepsat „Když začínáš" na resolution přes AGENTS.md**

Body 1–3 nahradit:

```markdown
1. **Najdi pracovní složku** — kořen s `AGENTS.md`, který popisuje strukturu
   (typicky cwd nebo některý z jeho rodičů). Pokud ho nenajdeš, zeptej se user
   na cestu; pokud složka ještě neexistuje, nasměruj ho na skill `init`.
2. **Přečti `AGENTS.md`** — obsahuje konvence a mapping název nemovitosti → složka.
3. **Identifikuj property**:
   - Z user promptu (jméno nemovitosti)
   - Nebo přes MCP `properties_list` a zeptej se user
4. **Resolvuj složku**:
   - Pokud `AGENTS.md` má explicitní mapping pro tuhle property, použij ho
   - Jinak default konvence: složka se jmenuje jako slug (property name
     kebab-cased, např. "<Property Name>" → `<property-name>`)
   - **Nikdy neodvozuj slug, když `AGENTS.md` říká něco jiného** — uživatel
     může mít archiv pojmenovaný po svém a nemá ho kvůli nám přejmenovávat
5. **Hledej `<složka>/_agent/`**:
   - **Pokud existuje**: čti `<složka>/_agent/README.md`, použij tamní parsery a pravidla
   - **Pokud ne**: vstoupíš do **learning mode** (níže)
```

- [ ] **Step 4: Přepsat cesty v Learning mode a v Konvencích**

Náhrady napříč souborem (jsou to prosté rewrity cest, obsah vět zůstává):

| dnes | nově |
|---|---|
| `properties/<slug>/` | `<složka>/_agent/` |
| `properties/<slug>/README.md` | `<složka>/_agent/README.md` |
| `properties/<slug>/<source>_parser.py` | `<složka>/_agent/<source>_parser.py` |
| `properties/<slug>/fixtures/` | `<složka>/_agent/fixtures/` |
| `scripts/` (sdílené skripty ve skillu) | `scripts/` **v tomto skillu** (v pluginu, ne v pracovní složce) |

V sekci *Konvence (kam co dát)* nahradit odrážku o `scripts/`:

```markdown
- `scripts/generate_reconciliation_pdf.py` — v **tomto skillu** (v pluginu), ne
  v pracovní složce. Spouští se jako CLI, viz krok 10 workflow.
- `<složka>/_agent/pdf-<rok>.json` — data pro PDF daného roku (hodnoty z MCP
  a podkladů, ne hardcoded sazby). Schema viz `scripts/example-pdf-data.json`.
```

Odrážku `properties/<slug>/generate_pdf_<year>.py` smazat — per-property už nedrží kód pro PDF, jen data.

- [ ] **Step 5: Přepsat krok 10 workflow**

```markdown
10. **Generuj PDF pro nájemce** — naplň `<složka>/_agent/pdf-<rok>.json` podle
    schematu v `scripts/example-pdf-data.json` a spusť generátor z tohoto skillu:

    ```bash
    python3 <cesta-k-tomuto-skillu>/scripts/generate_reconciliation_pdf.py \
        --data <složka>/_agent/pdf-<rok>.json \
        --out  <složka>/vyuctovani/<rok>/
    ```

    Cestu ke skriptu si odvoď od umístění tohoto `SKILL.md` — nehardcoduj ji
    a nekopíruj skript do pracovní složky.
```

- [ ] **Step 6: Přepsat sekci „Self-update"**

Bod 3 nahradit:

```markdown
3. Piš do `<složka>/_agent/...` v pracovní složce — **nikdy** do pluginu
```

- [ ] **Step 7: Ověřit, že nezůstaly odkazy na zrušené cesty**

Run:
```bash
grep -n "properties/<slug>\|\.template-version\|templates/skill\|contracts/SKILL\|generate_pdf_<year>" \
  claude-plugin/skills/rocni-vyuctovani/SKILL.md
```
Expected: žádný výstup (exit 1 z grepu).

- [ ] **Step 8: Commit**

```bash
git add claude-plugin/skills/rocni-vyuctovani/SKILL.md
git commit -m "refactor(skill): resolve properties via AGENTS.md, drop template-copy assumptions"
```

---

### Task 4: Přepsat `skills/smlouvy/SKILL.md`

**Files:**
- Modify: `claude-plugin/skills/smlouvy/SKILL.md` (206 ř.; cesty na ř. 25, 27, 96–99, 112, 155, 191–198)

**Interfaces:**
- Consumes: konvenci `<složka>/_agent/` z úlohy 3
- Produces: cesty `_agent/smlouvy/`, které zakládá `init` v úloze 5

Oba workflow (A — learn template, B — render document) i katalog proměnných zůstávají obsahově beze změny. Mění se **jen kam se zapisuje**.

- [ ] **Step 1: Přidat `name` do frontmatteru**

```yaml
---
name: smlouvy
description: Generování a reformat smluv a dodatků pro rental-management. Dva režimy — "learn template" (vyrobí Typst šablonu z existujícího PDF/DOCX dokumentu), "render document" (z uložené šablony + dat z MCP vyrobí čistý PDF). Aktivuj když user řekne "vyrob smlouvu", "udělej dodatek", "učeš tu starou smlouvu", "vytvoř template z dokumentu" apod.
---
```

- [ ] **Step 2: Přepsat cesty**

| dnes | nově |
|---|---|
| `contracts/templates/` (sdílené) | `_agent/smlouvy/` v pracovní složce |
| `properties/<slug>/contracts/templates/` | `<složka>/_agent/smlouvy/` |
| `contracts/templates/INDEX.md` | `_agent/smlouvy/INDEX.md` |
| výstup `properties/<slug>/contracts/<year>/` | `<složka>/najem/<rok>-<najemce>/` |

Sekci o umístění šablon (ř. 25) nahradit:

```markdown
- **Šablony** žijí v pracovní složce: `_agent/smlouvy/` (sdílené napříč
  nemovitostmi) NEBO `<složka>/_agent/smlouvy/` (per-property). Sdílené má
  přednost při nejasnosti. Pracovní složku a mapping název → složka najdeš
  v `AGENTS.md` v jejím kořeni.
- **`lease-cs.typ` v tomto skillu** (`templates/lease-cs.typ`) je generic
  reference starting point. Čti ji, needituj — je součástí pluginu.
- **Output**: PDF + `.typ` source vedle sebe, default `<složka>/najem/<rok>-<najemce>/`.
```

- [ ] **Step 3: Přepsat „Ulož template" (Workflow A, krok 6–7) a „Self-update"**

```markdown
6. **Ulož template** — zeptej se kam:
   - Default: `_agent/smlouvy/<name>.typ` (sdílené napříč nemovitostmi)
   - Per-property: `<složka>/_agent/smlouvy/<name>.typ`
7. **Update template index** — udržuj `_agent/smlouvy/INDEX.md` s řádkem
   `name | kind | language | description | path`. Pokud INDEX.md ještě
   neexistuje, založ ho i s hlavičkou tabulky.
```

V *Self-update* (ř. 191–198) tytéž cesty.

- [ ] **Step 4: Ověřit, že nezůstaly odkazy na zrušené cesty**

Run:
```bash
grep -n "properties/<slug>\|contracts/templates" claude-plugin/skills/smlouvy/SKILL.md
```
Expected: žádný výstup.

- [ ] **Step 5: Commit**

```bash
git add claude-plugin/skills/smlouvy/SKILL.md
git commit -m "refactor(smlouvy): write learned templates into the workspace, not the plugin"
```

---

### Task 5: Skill `init` + tenký command

Nový skill. Nekopíruje z pluginu nic — jen zakládá strukturu pracovní složky, nebo přerovnává existující hromadu dokumentů. Command je jen spouštěč, proto je ve stejné úloze.

**Files:**
- Create: `claude-plugin/skills/init/SKILL.md`
- Rewrite: `claude-plugin/commands/init.md` (105 ř. → ~15 ř.)

**Interfaces:**
- Produces: `AGENTS.md` v pracovní složce, jehož mapping čte úloha 3; adresář `_agent/smlouvy/`, který používá úloha 4.

- [ ] **Step 1: Napsat `skills/init/SKILL.md`**

```markdown
---
name: init
description: Založ nebo přerovnej pracovní složku pro správu nemovitostí — AGENTS.md, kostra složek per byt, volitelně .mcp.json. Aktivuj když user řekne "založ složku na byty", "nastav rental management", "přerovnej mi tyhle dokumenty" apod.
---

# Init: pracovní složka pro správu nemovitostí

Připraví složku, ve které uživatel drží dokumenty ke svým nemovitostem. Skilly
`rocni-vyuctovani` a `smlouvy` pak nad touhle strukturou pracují.

**Nic se nekopíruje z pluginu.** Skilly zůstávají v pluginu; do pracovní složky
patří jen to, co vlastní uživatel.

## Dva režimy

Zeptej se hned na začátku, který to je:

- **A — nová složka.** Založíš kostru na zelené louce.
- **B — přerovnání existující.** Uživatel už má dokumenty naházené a chce je
  dostat do téhle struktury.

## Cílová struktura

    <workspace>/
      AGENTS.md                    vstupní bod pro agenta
      README.md                    lidský rozcestník
      _agent/
        smlouvy/
          INDEX.md                 katalog naučených Typst šablon
      <slug>/                      jedna složka na nemovitost
        _agent/
          README.md                metodika vyúčtování pro tenhle byt
          <zdroj>_parser.py
          pdf-<rok>.json
          fixtures/
        nemovitost/  hypoteka/  pojisteni/
        najem/<rok>-<najemce>/
        svj/<rok>/  energie/  banka/  naklady/<rok>/
        vyuctovani/<rok>/

Konvence: **česky, lowercase-kebab, bez diakritiky**, kategorie první, rok jako
podadresář, rok = **ten, který se vyúčtovává**.

Prefix `_` znamená „meta, ne dokumenty" a řadí složku nahoru. `_agent/` má
stejný význam na obou úrovních: v kořeni sdílené, v bytě specifické pro ten byt.

## Režim A — nová složka

1. **Zeptej se na cestu.** Doporuč `~/Documents/<něco>`, ale respektuj volbu.
2. **Zeptej se na nemovitosti** — název + adresa. Slug odvoď kebab-casem;
   ukaž ho a nech potvrdit.
3. **Založ** kostru výše. Prázdné adresáře nechávej prázdné — negeneruj
   placeholder soubory kromě `AGENTS.md`, `README.md` a `_agent/smlouvy/INDEX.md`.

   `README.md` je krátký lidský rozcestník; seznam nemovitostí **needubluj**,
   odkaž na `AGENTS.md`, ať se ty dvě kopie nerozejdou:

       # <název workspace>

       Dokumenty k nemovitostem. Jedna složka na nemovitost — seznam a mapování
       názvů na složky je v `AGENTS.md`, konvence pojmenování taky.

       Zdroj pravdy pro částky a historii vyúčtování je MCP, ne tyhle adresáře.

   `_agent/smlouvy/INDEX.md` založ jen s hlavičkou, řádky přidává skill `smlouvy`:

       # Katalog šablon

       Mapování jméno → kind/jazyk/path. Skill `smlouvy` sem přidá řádek po každém
       naučení nové šablony (Workflow A).

       | name | kind | language | description | path |
       |------|------|----------|-------------|------|

       - **kind**: `lease` (smlouva) | `amendment` (dodatek) | `protocol` | jiné
       - **language**: `cs` | `en` | dvojjazyčné jako `cs-en`
       - **path**: relativní k tomuto souboru
4. **Napiš `AGENTS.md`** podle šablony níže.
5. **Nabídni `.mcp.json`** (viz níže).

## Režim B — přerovnání existující složky

1. **Projdi, co tam je** — `find <cesta> -maxdepth 3 -type d` a vzorek souborů.
2. **Navrhni mapování** starých cest na cílovou strukturu. Ukaž ho jako tabulku
   `odkud → kam` a **počkej na potvrzení**.
3. **Přesouvej, nikdy nemaž.** Použij `git mv` pokud je složka ve verzovacím
   systému, jinak `mv`. Co nezařadíš, nech na místě a vypiš to na konci.
4. **Nepřejmenovávej identifikátory od zdroje** — faktury a výpisy si nechávají
   jméno, které jim dal vystavovatel; parsery na ně můžou globovat. Popisně
   přejmenovávej jen neprůhledné názvy (`scan001.pdf`).
5. **Napiš `AGENTS.md`.** Pokud se složky nejmenují jako slugy (běžné
   u existujícího archivu), zapiš do něj explicitní mapping — přejmenovávat
   není potřeba.
6. Na konci ukaž souhrn: co se přesunulo, co zůstalo nezařazené.

## Šablona `AGENTS.md`

    # <název workspace> — pracovní složka

    Jedna složka na nemovitost. Dokumenty jsou tady, **zdroj pravdy pro částky
    a historii vyúčtování je MCP** (`rental-management`), ne tyhle adresáře.

    Postup vyúčtování a generování smluv dodává plugin `rental-management`
    (skilly `rocni-vyuctovani` a `smlouvy`). Tenhle soubor popisuje jen to,
    kde co leží.

    ## Nemovitosti

    | Nemovitost | Složka | Stav |
    |---|---|---|
    | <Název A> | `<slug-a>/` | pronájem |
    | <Název B> | `<slug-b>/` | pronájem |

    Default konvence je, že se složka jmenuje jako slug nemovitosti. Tabulka výše
    je závazná — když se od konvence liší, platí tabulka.

    ## Konvence

    - česky, lowercase-kebab, bez diakritiky
    - kategorie první, rok jako podadresář
    - rok = ten, který se vyúčtovává
    - `_` prefix = meta, ne dokumenty

    ## Kostra složky nemovitosti

    <zkopíruj strukturu ze sekce „Cílová struktura" výše>

    ## Dvě pravidla, která se nesmí porušit

    1. **Nepřejmenovávat identifikátory od zdroje.** Faktury a výpisy si drží
       jméno od vystavovatele — parsery na ně globují.
    2. **Podklady odděleně od výstupů.** `svj/`, `energie/`, `banka/` jsou
       vstupy, `vyuctovani/` je to, co dostane nájemce.

Konkrétní nemovitosti a stavy doplň podle toho, co ti user řekl. Neuváděj
jména nájemců ani částky — ty patří do MCP.

## Volitelně: `.mcp.json`

Zeptej se, jestli má založit napojení na backend. Pokud ano, zeptej se na
API URL a token (generuje se v aplikaci na `/settings/api-tokens`) a zapiš
do `<workspace>/.mcp.json`:

    {
      "mcpServers": {
        "rental-management": {
          "command": "npx",
          "args": ["-y", "@esnerda/cz-rental-management-mcp@latest"],
          "env": {
            "RENTAL_API_URL": "<URL>",
            "RENTAL_API_TOKEN": "<TOKEN>"
          }
        }
      }
    }

**`.mcp.json` obsahuje token — připomeň, ať ho user nedává do gitu.**

## Na závěr

Řekni user:

- kde složka je a co v ní vzniklo
- že vyúčtování spustí přes „spočítej vyúčtování <nemovitost>", smlouvy přes
  „vyrob dodatek" / „udělej smlouvu"
- doporuč `brew install typst pandoc poppler`, pokud chce používat skill
  `smlouvy` (typst kompiluje, pandoc dělá DOCX→MD, poppler PDF preview)

## Safety

- **Nikdy** nemaž uživatelská data. Přerovnání je posloupnost přesunů.
- **Vždy** ukaž plán (co kam) a počkej na potvrzení, než sáhneš na disk.
- Prázdné adresáře neplň placeholder soubory.
```

- [ ] **Step 2: Přepsat `commands/init.md` na tenký wrapper**

```markdown
---
description: Založ nebo přerovnej pracovní složku pro správu nemovitostí (AGENTS.md + kostra složek). Spustit jednou na začátku.
---

Použij skill `init` z tohoto pluginu a proveď uživatele založením pracovní
složky — nebo přerovnáním existující, pokud už dokumenty má.

Argumenty od uživatele (cesta ke složce, seznam nemovitostí) předej skillu;
pokud nic nezadal, skill se doptá sám.
```

- [ ] **Step 3: Ověřit strukturu i frontmatter všech tří skillů**

Run:
```bash
/tmp/check-layout.sh
for f in claude-plugin/skills/*/SKILL.md; do
  echo "--- $f"; sed -n '1,4p' "$f"
done
grep -rn "templates/skill\|commands/update\|~/.claude/skills" claude-plugin/ || echo "žádné mrtvé odkazy"
```
Expected: `layout OK`; každý SKILL.md začíná `---` + `name:` odpovídající jménu adresáře + `description:`; žádné mrtvé odkazy.

- [ ] **Step 4: Commit**

```bash
git add claude-plugin/skills/init claude-plugin/commands/init.md
git commit -m "feat(init): scaffold the workspace instead of copying a template"
```

---

### Task 6: Verze, changelog, README pluginu

**Files:**
- Modify: `claude-plugin/.claude-plugin/plugin.json` (`version`, `description`)
- Modify: `claude-plugin/CHANGELOG.md` (nový záznam nahoru, pod hlavičku s pravidly verzování)
- Modify: `claude-plugin/README.md` (75 ř. — popisuje instalaci jako kopírování šablony)

- [ ] **Step 1: Bump verze a description**

```json
{
  "name": "rental-management",
  "version": "1.0.0",
  "description": "Roční vyúčtování pronájmu — skilly pro správu nájemních smluv, vyúčtování služeb a srážek z nájmu nad pracovní složkou s dokumenty, s MCP backendem.",
  "author": {
    "name": "David Esner",
    "email": "esnerda@gmail.com"
  }
}
```

- [ ] **Step 2: Záznam v CHANGELOG.md**

Vložit hned pod blok s pravidly verzování, nad `## 0.3.3`:

```markdown
## 1.0.0 — 2026-08-28

### Changed — BREAKING

- **Plugin už nekopíruje šablonu skillu.** `templates/skill/` zrušeno; obsah se
  rozpadl na tři skilly v `skills/`: `rocni-vyuctovani`, `smlouvy`, `init`.
  Skilly žijí v pluginu v jediné kopii a aktualizují se s ním.
- **Znalost o nemovitosti se přestěhovala k dokumentům.** Metodika, parsery
  a fixtures nežijí v `~/.claude/skills/.../properties/<slug>/`, ale
  v `<nemovitost>/_agent/` v pracovní složce uživatele.
- **Rozlišení nemovitosti přes `AGENTS.md`.** Skill už neodvozuje
  `slug → properties/<slug>/`; čte mapping název → složka z `AGENTS.md`
  v kořeni pracovní složky. Default konvence zůstává „složka = slug", ale
  existující archiv se kvůli pluginu nemusí přejmenovávat.
- **PDF generátor je CLI entry point, ne knihovna.** Místo per-property
  `generate_pdf_<year>.py`, který importoval `build_pdf()` relativní cestou,
  se spouští `generate_reconciliation_pdf.py --data <json> --out <dir>`
  a nemovitost dodává jen data. Odstraňuje závislost na cestě do plugin
  cache, jejíž součástí je číslo verze.
- **Naučené Typst šablony a `INDEX.md`** se zapisují do `_agent/smlouvy/`
  v pracovní složce, ne do pluginu, kde je update přepisoval.

### Removed

- `commands/update.md` — merge šablony do lokální kopie. Není co mergovat.
- `.template-version` a kontrola verze šablony na začátku konverzace.
- Kroky „najdi template → zkopíruj → symlinkuj" z `commands/init.md`.
```

- [ ] **Step 3: Přepsat README.md**

Sekce *Instalace* / *Setup* přestává mluvit o kopírování do `~/.claude/skills/`. Nový obsah:

```markdown
## Instalace

1. Nainstaluj plugin — skilly `rocni-vyuctovani`, `smlouvy` a `init` se načtou s ním.
2. Spusť `/rental-management:init` a nech se provést založením pracovní složky
   (nebo přerovnáním té, kterou už máš).
3. Volitelně nech `init` založit `.mcp.json` s napojením na backend.

Plugin **nic nekopíruje** do pracovní složky. Skilly zůstávají v něm a aktualizují
se jeho updatem; ve složce žije jen to, co vlastníš ty — dokumenty, metodika
per nemovitost (`<nemovitost>/_agent/`) a naučené smluvní šablony (`_agent/smlouvy/`).
```

Zbytek souboru projít cíleně — vypiš zbývající místa a oprav jen ta:

```bash
grep -n "templates/\|~/.claude/skills\|properties/\|update\|zkopíruj\|symlink" \
  claude-plugin/README.md
```

Každý zásah je jedna ze dvou náhrad: cesta `properties/<slug>/` →
`<nemovitost>/_agent/`, nebo věta o kopírování/symlinkování → věta o tom, že
skilly zůstávají v pluginu. Sekci *MCP backend* nech být, ta je pořád platná.

- [ ] **Step 4: Finální kontrola celého pluginu**

Run:
```bash
/tmp/check-layout.sh
grep -rn "templates/skill\|commands/update\|\.template-version\|properties/<slug>" claude-plugin/ \
  || echo "žádné mrtvé odkazy"
grep '"version"' claude-plugin/.claude-plugin/plugin.json
head -20 claude-plugin/CHANGELOG.md
```
Expected: `layout OK`; žádné mrtvé odkazy; `"version": "1.0.0"`; changelog začíná záznamem 1.0.0.

- [ ] **Step 5: Commit a push**

```bash
git add claude-plugin
git commit -m "chore(plugin): bump to 1.0.0, document the workspace-owned layout"
git push -u origin feat/workspace-owned-knowledge
```

---

## Poznámka k testování

Úloha 2 je jediná s klasickým TDD cyklem — je to jediný kód. Úlohy 1 a 3–6 jsou
markdown a jejich „testem" je strukturální kontrola (`/tmp/check-layout.sh`)
a grep na mrtvé odkazy. To je záměr, ne mezera: skilly se ověřují tím, že se
podle nich dá projít workflow, což je akceptační krok po merge — přerovnání
reálné pracovní složky, které je mimo rozsah tohohle plánu.

CI (`test`, `typecheck`, `build`) je TypeScript-only a `claude-plugin/`
nepokrývá; musí ale zůstat zelená, protože se do ní nesahá.

---

## Po merge: jednorázová migrace (mimo seznam úloh)

Není součástí pluginu ani žádné úlohy výše — plugin se píše, jako by to tak bylo
vždycky. Tohle je jednorázový úklid jediné existující instalace.

**Cíl: `~/.claude/skills/rental-management/` po dokončení neexistuje.** Všechno
user-owned z ní je přestěhované do pracovní složky, všechno template-owned
zahodit (žije v pluginu).

- [ ] **Inventura první.** Vypsat celý strom `~/.claude/skills/rental-management/`
      a klasifikovat každý soubor: user-owned (stěhuje se) vs template-owned
      (zahodit) vs smetí (`__pycache__`, `.DS_Store`). Nic nemazat před přesunem.
- [ ] **Per-property znalost** → `_agent/` u dokumentů, podle skutečných jmen složek:
      `properties/kejruv-park/` → `<workspace>/KP/_agent/`,
      `properties/central-park/` → `<workspace>/CentralPark/_agent/`.
      Stěhuje se `README.md`, `*_parser.py`, `fixtures/`.
- [ ] **`generate_pdf_<rok>.py` → `pdf-<rok>.json`.** Z každého property skriptu
      vytáhnout `RECONCILIATION` dict a zapsat jako JSON (Decimal → desetinné
      číslo, tuply → pole). Python soubor pak zahodit — kód pro PDF je v pluginu.
      Ověřit rovnost výstupu: vygenerovat PDF starou i novou cestou a porovnat.
- [ ] **Smluvní šablony** `contracts/templates/` → `<workspace>/_agent/smlouvy/`
      včetně `INDEX.md`; cesty v INDEXu přepsat na nové umístění.
- [ ] **Napsat `<workspace>/AGENTS.md`** — mapping musí zachytit, že se složky
      nejmenují jako slugy (`Kejrův Park` → `KP/`, `Central Park` → `CentralPark/`
      atd.). Nic se nepřejmenovává.
- [ ] **Upravit `<workspace>/README.md`** — tabulku nemovitostí odstranit,
      odkázat na `AGENTS.md` (jinak se ty dvě kopie rozejdou).
- [ ] **Regression** — spustit fixtures proti přestěhovaným parserům; fail = STOP.
- [ ] **Teprve pak smazat** `~/.claude/skills/rental-management/` i případný
      symlink. Předtím ověřit, že v ní nezůstal soubor, který nemá kopii jinde.
