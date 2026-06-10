# Templates Index

Mapování jméno → kind/jazyk/path. Skill čte tento soubor při Workflow B (render document)
pro vyhledání správné šablony.

Format: `| name | kind | language | description | path |`

Po každém přidání nové šablony (přes Workflow A — learn template) doplň řádek sem.

| name | kind | language | description | path |
|------|------|----------|-------------|------|
| lease-cs | lease | cs | Generic reference smlouva CZ — výtah ze standardní NS šablony, krátký (Č1, Č3, Č4, Č5). Použít jako starting point nebo nechat skill vyrobit ze zdroje. | `templates/lease-cs.typ` |

## Konvence

- **kind**: `lease` (smlouva) | `amendment` (dodatek) | jiné (např. `protocol` — předávací protokol)
- **language**: `cs` | `en` | dvojjazyčné označuj jako `cs-en`
- **path**: relativní k `contracts/` složce ve skill root
- Per-property šablony žijí v `properties/<slug>/contracts/templates/` — INDEX si veď samostatně tam pokud má smysl
