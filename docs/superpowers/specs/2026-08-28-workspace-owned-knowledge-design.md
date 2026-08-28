# Workspace-owned knowledge: rozdělení pluginu a pracovní složky

Datum: 2026-08-28
Stav: návrh k implementaci

## Problém

Plugin dnes nese `templates/skill/`, který se instalací **zkopíruje** do
`~/.claude/skills/rental-management/`. Ta kopie pak obsahuje dvě věci
s protichůdným životním cyklem:

| | vlastník | update |
|---|---|---|
| `SKILL.md`, `contracts/SKILL.md`, `scripts/` | plugin | má přijít nová verze |
| `properties/<slug>/`, naučené Typst šablony | uživatel | nikdy nepřepisovat |

Z toho plynou tři potíže:

1. **Merge mašinérie.** `commands/update.md` musí rozdíl vlastnictví rekonstruovat
   ze seznamu cest a řešit per-soubor diff / overwrite / skip. ~150 řádků, které
   existují jen kvůli tomu, že jsou obě věci v jednom stromě.
2. **Znalost je odtržená od dat.** Metodika a parsery pro byt žijí
   v `~/.claude/skills/…/properties/<slug>/`, zatímco dokumenty, které parsují,
   jsou v uživatelově složce s byty. Důkaz: property skripty už dnes obsahují
   absolutní `OUTPUT_DIR` mířící do té složky.
3. **Jiné harnessy.** Nástroje, které nenačítají `~/.claude` (Claude Cowork,
   ChatGPT Work), na tu znalost nedosáhnou a nemůžou ji upravovat, přestože
   pracují přímo nad složkou s dokumenty.

## Rozhodnutí

**Plugin nese postup. Pracovní složka nese znalost, data a výstupy.**
Nic se nekopíruje, protože se nic nepřekrývá.

Důsledky, ze kterých vychází zbytek dokumentu:

- Skilly zůstávají v pluginu v jediné kopii a jsou **generické** — předpokládají
  strukturu pracovní složky popsanou níže, ne konkrétní obsah.
- Pracovní složka neobsahuje **žádný** soubor pocházející z pluginu. Není co
  synchronizovat, není co mergovat, není potřeba verzovací marker.
- Per-property znalost není skill, ale **paměť** — patří k tomu, co popisuje,
  tedy vedle dokumentů daného bytu.

## Layout pluginu

```
claude-plugin/
  .claude-plugin/plugin.json          version 1.0.0
  CHANGELOG.md
  README.md
  commands/
    init.md                           tenký wrapper → skill init
  skills/
    rocni-vyuctovani/
      SKILL.md
      scripts/
        generate_reconciliation_pdf.py
    smlouvy/
      SKILL.md
      templates/
        lease-cs.typ                  generic reference, skill si ji čte
    init/
      SKILL.md
```

Jména skillů kebab-case — konvence napříč ekosystémem (z ~200 nainstalovaných
skillů nepoužívá podtržítko ani jeden).

## Layout pracovní složky

```
<workspace>/
  AGENTS.md                    vstupní bod pro agenta
  README.md                    lidský rozcestník
  _agent/
    smlouvy/
      INDEX.md                 naučené šablony: name | kind | language | path
      <nazev>.typ
  <slug>/
    _agent/
      README.md                metodika vyúčtování pro tenhle byt
      <zdroj>_parser.py        parsery specifické pro tenhle byt
      pdf-<rok>.json           data pro PDF (viz níže)
      fixtures/                <rok>-<zdroj>.{input,expected}.json
      smlouvy/                 per-property šablony, jen když je potřeba
    nemovitost/  hypoteka/  pojisteni/
    najem/<rok>-<najemce>/     smlouva + dodatky
    svj/<rok>/  energie/  banka/  naklady/<rok>/
    vyuctovani/<rok>/          výstup nájemci
```

Prefix `_` znamená „meta, ne dokumenty" a řadí složku nahoru. `_agent/` má
stejný význam na obou úrovních: v rootu sdílené napříč byty, v bytě specifické
pro ten byt.

## AGENTS.md

Soubor v rootu pracovní složky, **user-owned**, zakládá ho `init`. Role: první
věc, kterou agent v té složce přečte — i takový, který skill vůbec nenačetl.
Obsahuje:

- k čemu ta složka je a že postup dodává plugin `rental-management`
- konvence pojmenování (česky, lowercase-kebab, bez diakritiky, rok = ten,
  který se vyúčtovává)
- **mapping byt → složka** (viz níže)
- kostru složky bytu a co kam patří

`README.md` zůstává lidský rozcestník s prózou (kostra, pravidla, poznámky
k archivu) a na seznam bytů odkazuje do `AGENTS.md`. Tabulka bytů je jen na
jednom místě, aby se ty dvě kopie nerozešly.

## Rozlišení property

`SKILL.md` dnes odvozuje `slug = kebab-case(property name)` a hledá
`properties/<slug>/`. Nově:

1. Default konvence: **složka se jmenuje jako slug.**
2. `AGENTS.md` smí mapping přebít explicitní tabulkou `název → složka`.
3. Skill se ptá `AGENTS.md`, neodvozuje.

Tím je nestandardní pojmenování složek podporovaná cesta, ne výjimka — uživatel
s existujícím archivem nemusí nic přejmenovávat.

## Skill `rocni-vyuctovani`

Vychází z dnešního `templates/skill/SKILL.md`. Změny:

- **Pryč sekce „0. Check template updates"** — existovala jen kvůli kopii.
- **Resolution property** podle `AGENTS.md` místo `properties/<slug>/`.
- **Learning mode** zakládá `<slug>/_agent/README.md` v pracovní složce.
- Konvence „kam co dát" přepsané na `<slug>/_agent/`.
- Pravidla *Co patří / nepatří do property README* zůstávají beze změny
  (metodika ano, konkrétní částky/jména/datumy ne — ty jsou v MCP).
- Zákaz počítání v hlavě zůstává.

### PDF: obrácení toku

Dnes property skript **importuje** sdílenou knihovnu relativní chůzí po stromě
(`parents[2]` + `sys.path.insert`). To funguje jen dokud jsou obě věci v jednom
stromě; po rozdělení by cesta vedla do plugin cache, jejíž součástí je číslo
verze, a rozbila by se při každém upgradu.

Řešení: sdílený skript je **entry point**, ne knihovna.

```
python <skill>/scripts/generate_reconciliation_pdf.py \
    --data <slug>/_agent/pdf-<rok>.json \
    --out  <slug>/vyuctovani/<rok>/
```

- `RECONCILIATION` dict je už dnes dokumentované schema v hlavičce souboru →
  stává se z něj JSON.
- Cestu ke skriptu nikdo nepředává: agent čte `SKILL.md` z té složky, takže
  ji zná.
- Per-property `_agent/` tím drží **data, ne kód** pro PDF.
- `OUTPUT_DIR` přestává být natvrdo v souboru → skript je přenositelný.

## Skill `smlouvy`

Vychází z `templates/skill/contracts/SKILL.md`. Oba workflow (learn template /
render document) zůstávají. Změny jsou v tom, kam se zapisuje:

| | dnes | nově |
|---|---|---|
| naučené šablony | `contracts/templates/` (v kopii skillu) | `_agent/smlouvy/` |
| per-property šablony | `properties/<slug>/contracts/templates/` | `<slug>/_agent/smlouvy/` |
| INDEX.md | v kopii skillu | `_agent/smlouvy/INDEX.md` |
| výstup | `properties/<slug>/contracts/<year>/` | `<slug>/najem/<rok>-<najemce>/` |

`lease-cs.typ` zůstává v pluginu — skill si ji jen čte jako starting point,
nikdo ji needituje. Naučené šablony jsou user-owned a do pluginu nepatří.

## Skill `init`

Nekopíruje nic. Umí:

1. **Založit novou pracovní složku** — `AGENTS.md`, `README.md`, `_agent/smlouvy/`,
   a per byt kostru složek.
2. **Přeorganizovat existující složku dokumentů** — projít, co uživatel má,
   navrhnout mapování do kostry, a po potvrzení přesunout. Nikdy nemazat,
   vždy ukázat plán před zápisem.
3. **Nabídnout `.mcp.json`** pro backend (`npx @esnerda/cz-rental-management-mcp`).

`commands/init.md` je tenký wrapper, který skill zavolá.

## Co se maže

- `commands/update.md` — celý
- `templates/` — celý strom (obsah se stěhuje do `skills/`)
- `.template-version` a všechna logika kolem verzí šablony
- sekce „0. Check template updates" v `SKILL.md`
- kroky 1, 3, 4, 5 z `commands/init.md` (najdi template → zkontroluj target →
  zkopíruj → symlinkuj)

## Co se přepisuje

- `claude-plugin/README.md` — dokumentuje instalaci jako „nainstaluj plugin →
  spusť init → skill se zkopíruje do `~/.claude/skills/`". Nově: plugin nese
  skilly, `init` zakládá pracovní složku.
- `.claude-plugin/plugin.json` — `description` mluví o workflow, ne o kopírování.

## Mimo rozsah

- **Zpětná kompatibilita a migrace** ze starého layoutu. Plugin se píše, jako by
  to tak bylo vždycky. Existující instalace se přerovná jednorázově, mimo tento
  dokument.
- **Soběstačnost pracovní složky bez pluginu.** Cowork/ChatGPT v ní budou znalost
  číst a upravovat, ale vyúčtování spočítá jen harness, který má plugin. Kdyby to
  jednou vadilo, čistá cesta je publikovat PDF knihovnu jako pip balíček —
  ne ji do složky kopírovat.
- **Symlinky do `.claude` / `.codex`.** Nejsou potřeba: skilly se načtou z pluginu
  a `AGENTS.md` je v rootu pracovní složky, kde ho nástroje najdou samy.

## Verze

Major bump → `1.0.0` (breaking change ve workflow) + záznam v `CHANGELOG.md`.
