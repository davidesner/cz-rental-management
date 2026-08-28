---
description: Generování a reformat smluv a dodatků pro rental-management. Dva režimy — "learn template" (vyrobí Typst šablonu z existujícího PDF/DOCX dokumentu), "render document" (z uložené šablony + dat z MCP vyrobí čistý PDF). Aktivuj když user řekne "vyrob smlouvu", "udělej dodatek", "učeš tu starou smlouvu", "vytvoř template z dokumentu" apod.
---

# Contract & Amendment Documents

Workflow pro generování smluv (nájemních) a jejich dodatků jako čisté PDF přes Typst. Skill umí:

- **Naučit se šablonu** z existujícího dokumentu (DOCX/PDF) — extrahuje strukturu, zaměří placeholdery, uloží jako reusable template
- **Vyrenderovat dokument** z uložené šablony naplněné aktuálními daty z MCP (tenant, contract, terms, property)

Předpokládá MCP server `rental-management` připojený.

## Stack

- **Typst** — moderní typesetting alternativa k LaTeX, jednodušší syntaxe, rychlejší kompilace. Check + install:
  ```bash
  which typst || brew install typst
  ```
- **pandoc** — konverze DOCX → MD pro analýzu (`brew install pandoc` pokud chybí)
- **pdftoppm** (z poppler) — preview JPGs z PDF pro review (`brew install poppler` pokud chybí)

## Konvence

- **Templates** žijí v `properties/<slug>/contracts/templates/` (per-property) NEBO `contracts/templates/` (sdílené napříč properties). Sdílené má přednost při nejasnosti.
- **Variable convention**: `{{namespace.field}}` syntaxe (mustache-style). Skill string-replace before compile, ne native Typst inputs (jednodušší debug).
- **Output**: PDF + `.typ` source vedle sebe. User volí kam uložit (default: cwd, nebo `properties/<slug>/contracts/<year>/`).
- **Naming**: `<TENANT>-<KIND>_<descriptor>_<lang>.pdf`, např. `NOVAK-DODATEK_5-od-7_26_CZ.pdf` (kebab/snake mix podle stylu user).
- **Verze**: každý render zapiše do `.typ` source vedle PDF — pak reformat / drobné úpravy se dělají v `.typ` a recompile.

## Variables katalog (běžné)

Pro **smlouvu** (lease):
- `{{landlord.name}}`, `{{landlord.address}}`, `{{landlord.dob}}`, `{{landlord.email}}`, `{{landlord.phone}}`
- `{{landlord.bankAccount}}` (číslo účtu na nájemné)
- `{{tenants}}` — pole nájemníků (alternativa: `{{tenant1.name}}`, `{{tenant2.name}}` pro fixní počet)
- `{{property.unitNumber}}` (např. "1234/56"), `{{property.cadastre}}` (např. "Vinohrady"), `{{property.address}}`, `{{property.layout}}` (např. "3+kk s terasou"), `{{property.accessories}}` (sklep, parkování)
- `{{lease.startDate}}`, `{{lease.endDate}}` (`YYYY-MM-DD`), `{{lease.fixedTermDescription}}` (např. "1 rok s automatickým prodloužením")
- `{{terms.baseRent}}` (CZK, formatted bez "Kč"), `{{terms.serviceAdvance}}`, `{{terms.paymentDueDay}}`
- `{{deposit.amount}}`, `{{deposit.dueDate}}`
- `{{partialFirst.fromDate}}`, `{{partialFirst.toDate}}`, `{{partialFirst.rent}}`, `{{partialFirst.services}}` (částečný první měsíc, pokud lease startuje v půlce)
- `{{signLocation}}`, `{{signDate}}`

Pro **dodatek** (amendment):
- Vše `landlord.*` + `tenant.*` + `property.*` jako u smlouvy
- `{{amendment.number}}` (např. "5"), `{{amendment.originalAgreementDate}}` (datum původní smlouvy)
- `{{amendment.effectiveDate}}` (od kdy nové podmínky)
- `{{terms.newBaseRent}}`, `{{terms.newServiceAdvance}}`, `{{terms.serviceBreakdown}}` (např. "<amount> CZK pro byt + 2 880 CZK elektřina")
- `{{lease.newEndDate}}`, `{{lease.extensionDeadline}}`
- `{{signLocation}}`, `{{signDate}}`

Templaty si mohou definovat vlastní vars — skill se přizpůsobí podle co najde v `.typ` souboru (regex `\{\{[\w.]+\}\}`).

---

## Workflow A — Learn template z existujícího dokumentu

Use case: user má DOCX/PDF (např. starou smlouvu, vzor od právníka, dodatek z minulého roku) a chce z toho šablonu co půjde znovu použít s jinými daty.

1. **User dodá dokument** (path k PDF/DOCX). Pokud DOCX, převést na MD:
   ```bash
   pandoc input.docx -o /tmp/source.md
   ```
   Pokud PDF, použij `Read` tool (Claude umí číst PDFs).

2. **Analyzuj strukturu**:
   - Identifikuj sekce/články (typicky "Článek N — Title")
   - Najdi všechny konkrétní hodnoty co budou variable (jména, adresy, datumy, částky, čísla jednotek)
   - Klasifikuj: které jsou stabilní (vlastník, adresa nemovitosti) vs. proměnné (nájemník, datum, sazba)

3. **Návrhni placeholders** — projdi s user-em:
   ```
   "Našel jsem tyto hodnoty co můžou být variable:
   - '<jméno vlastníka>' → {{landlord.name}}
   - '<adresa vlastníka>' → {{landlord.address}}
   - '<číslo jednotky>' → {{property.unitNumber}}
   - '<částka nájmu>' → {{terms.baseRent}}
   ...
   Souhlasíš? Nebo některé chceš nechat jako fixní text?"
   ```

4. **Napiš Typst** — převést MD/strukturu na `.typ` s placeholdery:
   - Použij `#set page`, `#set text`, `#set par` setup (viz Reference níže)
   - Articles renderovat jako `#article("I", "Title")[body]` helper (definuj v template header)
   - Lists jako `#item(1)[...]` helper
   - Placeholdery `{{var.name}}` přímo v textu

5. **Compile test** — vyrenderuj s dummy daty, ukaž preview:
   ```bash
   typst compile template.typ test-output.pdf
   pdftoppm -jpeg -r 100 test-output.pdf /tmp/preview
   ```
   Ukaž `/tmp/preview-1.jpg` user. Pokud OK, pokračuj.

6. **Ulož template** — zeptej se kam:
   - Default: `contracts/templates/<name>.typ` (sdílené)
   - Per-property: `properties/<slug>/contracts/templates/<name>.typ`

7. **Update template index** — udržuj `contracts/templates/INDEX.md` s `name | kind | language | description | path` aby skill snadno našel template později.

---

## Workflow B — Render document z uložené šablony

Use case: user řekne "vyrob dodatek pro <property> s novým nájmem od 2026-07-01".

1. **Identifikuj kind + property + lang**:
   - "dodatek" → kind=amendment
   - "<property name>" → property slug
   - Lang: zeptej se (cz/en), default cz

2. **Najdi template** — `contracts/templates/INDEX.md` nebo glob `**/*.typ` co matchne kind+lang. Pokud víc, ukaž user možnosti.

3. **Načti data z MCP**:
   ```
   properties_get(propertyId)
   contracts_list({ propertyId })  // pick the active one
   contracts_get(contractId)
   tenants_get(tenantId)
   contract_terms_list(contractId)  // active terms = open one (validTo === null)
   ```

4. **Sesbírej vars do JSON**:
   ```json
   {
     "landlord": { "name": "<landlord-name>", ... },
     "tenant": { "name": "<tenant-name>", ... },
     "property": { "unitNumber": "<unit-number>", ... },
     "terms": { "newBaseRent": "<amount>", ... },
     "amendment": { "number": "<n>", ... }
   }
   ```

5. **Doplň missing vars** — pro každý placeholder v template co není ve vars, zeptej se user:
   ```
   "Template potřebuje {{amendment.number}}. Aktuální max v UI je 4 → návrh 5. Potvrdit?"
   ```

6. **Render** — string replace `{{key}}` → value, write `.typ`:
   ```typescript
   const filled = templateContent.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
     const value = getNested(vars, key);
     if (value === undefined) throw new Error(`missing var: ${key}`);
     return String(value);
   });
   ```

7. **Compile + preview**:
   ```bash
   typst compile output.typ
   pdftoppm -jpeg -r 100 output.pdf /tmp/preview
   ```
   Ukaž preview-1.jpg user. Pokud chce změny → edit `.typ` přímo, recompile.

8. **Save final** — zeptej se kam (default: cwd nebo `properties/<slug>/contracts/<year>/`). Přesuň PDF + `.typ` source tam.

---

## Reference: Typst boilerplate

Začátek každé šablony (A4, CZ default):

```typst
#set page(
  paper: "a4",
  margin: (top: 2.5cm, bottom: 2.5cm, left: 2.8cm, right: 2.8cm),
)
#set text(font: "New Computer Modern", size: 11pt, lang: "cs")
#set par(justify: true, leading: 0.65em, spacing: 1.2em, first-line-indent: 0pt)

#let article(numeral, title, body) = {
  v(1.2em)
  align(center)[*Článek #numeral* \ *#title*]
  v(0.6em)
  body
}

#let item(n, body) = {
  par(hanging-indent: 1.2em)[*#n.* #h(0.4em) #body]
}
```

Pro EN šablonu: `lang: "en"` + `*#numeral.* \ *#title*` (bez slova "Článek").

**Sazba peněz**: doporučuji formátovat input už ve vars (např. `"12 345"` s nezlomitelnou mezerou), template přidá jen `*…CZK*` nebo `*…Kč*` podle jazyka.

**Justify + české typo**: `lang: "cs"` v Typst aktivuje správné dělení slov.

---

## Self-update (uložení template)

Když user řekne "ulož template" nebo "tohle si pamatuj":

1. **Ukaž preview a placeholders** — krátké shrnutí co se uloží
2. **Počkej na explicitní "ano"**
3. **Zapiš** do `contracts/templates/<name>.typ` (nebo per-property)
4. **Update INDEX.md** — řádek s `name | kind | language | description | path`

## Tipy

- **Variables nenajdeš všechny**: regex `\{\{[\w.]+\}\}` v `.typ` ti dá kompletní list. Vždy validuj že každý placeholder má hodnotu před compile (skill error pokud chybí).
- **Compile error**: typst vrátí čitelnou chybu se line/column. Použij to k debugu — typicky chybí escape (`#` v běžném textu), nebo unbalanced bracket.
- **Long unicode characters**: New Computer Modern má dobrou CZ podporu, ale pokud naseká glyphy, zkus `font: "Linux Libertine"` nebo `font: "Source Serif Pro"`.
- **Page numbers / footers**: `#set page(numbering: "1")` nebo custom footer přes `#set page(footer: ...)`.
- **Multi-tenant docs**: pokud má smlouva více nájemníků, použij Typst loop `#for t in tenants [ ... ]` místo fixed placeholders.
