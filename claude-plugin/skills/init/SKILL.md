---
name: init
description: Založ nebo přerovnej pracovní složku pro správu nemovitostí — AGENTS.md, kostra složek per byt, volitelně .mcp.json. Aktivuj když user řekne "založ složku na byty", "nastav rental management", "přerovnej mi tyhle dokumenty" apod.
---

# Init: pracovní složka pro správu nemovitostí

Připraví složku, ve které uživatel drží dokumenty ke svým nemovitostem. Skilly `rocni-vyuctovani` a `smlouvy` pak nad touhle strukturou pracují.

## Dva režimy

Zeptej se hned na začátku, který to je:

- **A — nová složka.** Založíš kostru na zelené louce.
- **B — přerovnání existující.** Uživatel už má dokumenty naházené a chce je dostat do téhle struktury.

## Cílová struktura

```
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
```

Konvence: **česky, lowercase-kebab, bez diakritiky**, kategorie první, rok jako podadresář, rok = **ten, který se vyúčtovává**.

Prefix `_` znamená „meta, ne dokumenty" a řadí složku nahoru. `_agent/` má stejný význam na obou úrovních: v kořeni sdílené, v bytě specifické pro ten byt.

## Režim A — nová složka

1. **Zeptej se na cestu.** Doporuč `~/Documents/<něco>`, ale respektuj volbu.
2. **Zeptej se na nemovitosti** — název + adresa. Slug odvoď kebab-casem; ukaž ho a nech potvrdit.
3. **Založ** kostru výše. Prázdné adresáře nechávej prázdné — negeneruj placeholder soubory kromě `AGENTS.md`, `README.md` a `_agent/smlouvy/INDEX.md`.

   `README.md` je krátký lidský rozcestník; seznam nemovitostí **needubluj**, odkaž na `AGENTS.md`, ať se ty dvě kopie nerozejdou:

   ```markdown
   # <název workspace>

   Dokumenty k nemovitostem. Jedna složka na nemovitost — seznam a mapování
   názvů na složky je v `AGENTS.md`, konvence pojmenování taky.

   Zdroj pravdy pro částky a historii vyúčtování je MCP, ne tyhle adresáře.
   ```

   `_agent/smlouvy/INDEX.md` založ jen s hlavičkou, řádky přidává skill `smlouvy`:

   ```markdown
   # Katalog šablon

   Mapování jméno → kind/jazyk/path. Skill `smlouvy` sem přidá řádek po každém
   naučení nové šablony (Workflow A).

   | name | kind | language | description | path |
   |------|------|----------|-------------|------|

   - **kind**: `lease` (smlouva) | `amendment` (dodatek) | `protocol` | jiné
   - **language**: `cs` | `en` | dvojjazyčné jako `cs-en`
   - **path**: relativní k tomuto souboru
   ```

4. **Napiš `AGENTS.md`** podle šablony níže.
5. **Nabídni `.mcp.json`** (viz níže).

## Režim B — přerovnání existující složky

1. **Projdi, co tam je** — `find <cesta> -maxdepth 3 -type d` a vzorek souborů.
2. **Navrhni mapování** starých cest na cílovou strukturu. Ukaž ho jako tabulku `odkud → kam` a **počkej na potvrzení**.
3. **Přesouvej, nikdy nemaž.** Použij `git mv` pokud je složka ve verzovacím systému, jinak `mv`. Co nezařadíš, nech na místě a vypiš to na konci.
4. **Nepřejmenovávej identifikátory od zdroje** — faktury a výpisy si nechávají jméno, které jim dal vystavovatel; parsery na ně můžou globovat. Popisně přejmenovávej jen neprůhledné názvy (`scan001.pdf`).
5. **Napiš `AGENTS.md`.** Pokud se složky nejmenují jako slugy (běžné u existujícího archivu), zapiš do něj explicitní mapping — přejmenovávat není potřeba.
6. Na konci ukaž souhrn: co se přesunulo, co zůstalo nezařazené.

## Šablona `AGENTS.md`

````markdown
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

```
<slug>/
  _agent/          metodika, parsery, fixtures, pdf-<rok>.json
  nemovitost/      LV, kupní smlouva, půdorys, vklad
  hypoteka/        zástavní právo, podklady k úvěru
  pojisteni/       smlouva, výroční dopisy
  najem/<rok>-<najemce>/   smlouva + dodatky
  energie/         faktury dodavatelů
  svj/<rok>/       co přišlo od správce
  banka/           výpisy
  naklady/<rok>/   jednorázové náklady vlastníka
  vyuctovani/<rok>/  výstup nájemci
```

## Dvě pravidla, která se nesmí porušit

1. **Nepřejmenovávat identifikátory od zdroje.** Faktury a výpisy si drží
   jméno od vystavovatele — parsery na ně globují.
2. **Podklady odděleně od výstupů.** `svj/`, `energie/`, `banka/` jsou
   vstupy, `vyuctovani/` je to, co dostane nájemce.
````

Konkrétní nemovitosti a stavy doplň podle toho, co ti user řekl. Neuváděj jména nájemců ani částky — ty patří do MCP.

## Volitelně: `.mcp.json`

Zeptej se, jestli má založit napojení na backend. Pokud ano, zeptej se na API URL a token (generuje se v aplikaci na `/settings/api-tokens`) a zapiš do `<workspace>/.mcp.json`:

```json
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
```

**`.mcp.json` obsahuje token — připomeň, ať ho user nedává do gitu.**

## Na závěr

Řekni user:

- kde složka je a co v ní vzniklo
- že vyúčtování spustí přes „spočítej vyúčtování <nemovitost>", smlouvy přes „vyrob dodatek" / „udělej smlouvu"
- doporuč `brew install typst pandoc poppler`, pokud chce používat skill `smlouvy` (typst kompiluje, pandoc dělá DOCX→MD, poppler PDF preview)

## Safety

- **Nikdy** nemaž uživatelská data. Přerovnání je posloupnost přesunů.
- **Vždy** ukaž plán (co kam) a počkej na potvrzení, než sáhneš na disk.
- Prázdné adresáře neplň placeholder soubory.
