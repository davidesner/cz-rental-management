# Rental Management — Design Spec

**Status:** Draft for review
**Owner:** David (esnerda@gmail.com)
**Date:** 2026-06-05

## 1. Cíl a kontext

Aplikace pro správu pronájmu bytů. Hlavní use case = **roční vyúčtování služeb nájemcům**: porovnání plánovaných záloh (dle smlouvy) se skutečnými náklady (z přicházejících vyúčtování od SVJ, elektrárny, plynárny atd.) → vypočtený rozdíl k vrácení/doplacení.

Stávající stav: vše ručně v Google Sheetu (`13N5c5T0-dKeNdZc7wFY8bcA9sQwxvvhZwRs2WMjEG9w`), platby z bankovních výpisů parsované přes Keboola transformaci, výsledná data pumpovaná zpět do sheetu.

Nový systém přesouvá tohle do dedikované aplikace s **MCP rozhraním jako prvotřídním vstupem** — uživatel/David si píše vlastní skilly (parser bankovních výpisů, parser elektřinových faktur, parser SVJ vyúčtování), které přes MCP plní data.

## 2. Funkční požadavky

### 2.1 Multi-tenant SaaS
- Více pronajímatelů, každý vlastní workspace (`Organization`)
- Sdílení org s dalšími uživateli (např. partner/účetní) s per-property scoping
- Auth: email+heslo pro MVP; architektura připravená na Google SSO později (multi-credential model)

### 2.2 Správa nemovitostí a smluv
- Evidence bytů (`Property`), nájemců (`Tenant`), smluv (`Contract`)
- **Smluvní ceny temporální (SCD2):** nájemné a dohodnuté zálohy se mohou v čase měnit (dodatkem, automatickým prodloužením). Změna = nový časový řádek v `ContractTerms` / `ContractUtility`.
- **Tarif od SVJ taky temporální** (`PropertyServiceTariff`): evidenční list se každý rok mění, deductible část (typicky fond oprav) se eviduje zvlášť.

### 2.3 Utility za smlouvu
- Smlouva může mít 0–N utilit (elektřina, plyn, internet, voda, other), každá s vlastní temporální platností a měsíční zálohou
- Pokud landlord neplatí (např. nájemce má vlastní smlouvu s elektrárnou), utility se prostě nezaeviduje

### 2.4 Platby
- Příchozí platby z banky (s `externalId` pro idempotentní reimport) i manuální zápisy
- **Žádná explicitní alokace** v DB — alokační pravidlo: per měsíc nejdřív pokrýt nájem, pak SVJ-služby, pak utility postupně
- Nepřiřazené platby (`contractId IS NULL`) jsou v inboxu k ručnímu/MCP přiřazení

### 2.5 Vstupy reálných nákladů
- `CostStatement` jako sběrné místo pro vyúčtování od SVJ / elektrárny / plynárny / poskytovatele internetu
- Skill zpracovává PDF/CSV a vkládá `CostStatement` přes MCP s `kind`, `periodFrom/To`, `totalAmount`, a volitelně signed `adjustmentAmount` + `adjustmentNote`
- Adjustment řeší doménovou logiku konkrétního typu nákladu (např. přičíst solar credit zpět u elektřiny — solar je placen z FO, takže nájemce nesmí dostat slevu; odečíst FO porci ze SVJ celku)
- Proporční výpočty (pokud období nesedí s rokem smlouvy) řeší skill, ne backend

### 2.6 Roční vyúčtování
- Per smlouva per období (typicky kalendářní rok, nebo proporcionální výřez)
- Per `kind`: skutečný náklad vs zaplaceno (alokované) → rozdíl
- Status `draft` → `finalized`
- **Výstup MVP: JSON/data**, žádný PDF generátor (skill si výstup vykreslí pokud chce)

**Reference test scenario (<property-name-a> 2024, <tenant-name>):**
- Smlouva: start 20.9.2024 (proporcionální první měsíc), `baseRent = <amount> Kč`, `serviceAdvance = 7 000 Kč` (bez FO), `electricityAdvance = 1 200 Kč`
- EvidenceList: `totalSvjAdvance = 8 884 Kč`, `deductibleAmount = 1 878 Kč` (z `slozky_fond_oprav`)
- Platby v období 9–12/2024: viz `platby` + `manual_payments` sheety
- SVJ vyúčtování: `totalAmount = 29 999.49 Kč`, `adjustmentAmount = −6 253.74 Kč` (FO portion), proporce 0.2814 (103 dní)
- Elektřina: `totalAmount = 3 168.67 Kč`, `adjustmentAmount = solar credit` (per měsíc 9–12)
- **Očekávaný výsledek: celkový rozdíl +693 Kč** (přeplatek, vrátit nájemci), viz sheet `Vyuctovani 2024`
- Plan 4 reprodukuje tento scénář přes REST, Plan 5 přes MCP, oba musí dát stejné číslo.

### 2.7 MCP rozhraní
- Lokální (stdio) v MVP — Claude Code spouští server přes `.mcp.json`
- Stejné toolky budou v budoucnu vystaveny jako Streamable HTTP/SSE (hosted varianta)
- Auth přes API token (Bearer), token vázán na `Membership` (zdědí scope na property)
- **Skilly orchestrují vyúčtování per property** — backend MCP poskytuje atomické operace (`get_property`, `create_cost_statement`, `record_payments`, `compute_reconciliation`); per-property workflow (která pravidla, jaký solar credit, jaké FO struktury) žije ve skill repu uživatele, ne v DB. Viz sekce 13.

## 3. Architektura

### 3.1 Stack
- **Backend:** TypeScript + Hono (REST API)
- **Frontend:** Vite + React + Tailwind + shadcn/ui + react-hook-form
- **Databáze:** libSQL přes Drizzle ORM (soubor pro local/Docker, Turso pro Vercel)
- **Auth:** `better-auth` (email+heslo pro MVP, OAuth schema-ready)
- **MCP:** `fastmcp` (stdio teď, Streamable HTTP/SSE později — stejný kód)
- **Deploy:** Vercel (HTTP) + Docker (full container)
- **Validace:** Zod pro REST + MCP inputy + Drizzle schémata

### 3.2 Layout

```
core/
  schema/       Drizzle schémata
  services/     Business logika (orgId-scoped, framework-agnostic)
  lib/          Datum/temporální utility, alokační pravidlo
  index.ts      Re-export pro konzumenty
server/
  index.ts      Hono app entry + routes mount
  routes/       REST endpointy per zdroj (properties, contracts, payments, …)
  auth.ts       better-auth integrace
  middleware/   Auth, error handling, request scoping
  node.ts       Node start (lokální dev + Docker)
  vercel.ts     Vercel adapter
mcp/
  index.ts      fastmcp server start (transport ze env)
  tools/        Tooly per doménu (properties, payments, statements, reconciliation, …)
  client.ts     Bearer-auth HTTP klient nad REST API
src/            React UI
  routes/       React-router stránky
  components/   UI komponenty (shadcn-based)
  lib/          Fetch helpery, hooks
docker/         Dockerfile, docker-compose, entrypoint
docs/           Spec + data model HTML
```

### 3.3 Datový tok

```
Bank PDF/CSV ─→ skill (parser) ─→ MCP tool recordPayments ─→ REST POST /payments ─→ DB
SVJ vyúčtování PDF ─→ skill ─→ MCP tool createCostStatement ─→ REST POST /cost-statements ─→ DB
Elektřina faktura ─→ skill ─→ MCP tool createCostStatement ─→ REST POST /cost-statements ─→ DB

UI ─→ REST GET/POST ─→ services/* ─→ Drizzle ─→ DB
MCP ─→ REST GET/POST (Bearer token) ─→ services/* ─→ Drizzle ─→ DB

Reconciliation:
  REST POST /reconciliations/compute → services.reconciliation.compute()
  → reads ContractTerms, ContractUtility, PropertyServiceTariff,
         Payment, CostStatement
  → returns ReconciliationItem[]
```

Klíčový princip: **jeden HTTP path, dva klienti** (UI a MCP). Žádná duplicita business logiky.

## 4. Datový model

Detailní vizualizace v `docs/data-model.html`. Souhrn:

### 4.1 Identity & multi-tenancy
- `User`, `Credential`, `Session` (better-auth)
- `Organization` — workspace pronajímatele
- `Membership(userId, orgId, role)` — role `owner` vidí všechno; `member` jen properties dle `PropertyAccess`
- `PropertyAccess(membershipId, propertyId)` — per-property scope pro non-owner
- `ApiToken(membershipId, name, tokenHash, lastUsedAt)` — Bearer pro MCP

### 4.2 Core
- `Property(orgId, name, address, reconciliationSkill?, note)`
  - `reconciliationSkill?` — string, optional, name skillu v uživatelově skill repu (např. `"kolcavka-reconciliation"`). `null` = použij default reconciliation skill. Viz sekce 13.
- `Tenant(orgId, name, email, phone, accountNumber, note)` — `accountNumber` pro vrácení přeplatku
- `Contract(orgId, propertyId, tenantId, startDate, endDate?, securityDeposit, note)` — žádné ceny, jen identita

### 4.3 Temporální (SCD2) — `validFrom`, `validTo?`
- `ContractTerms(contractId, validFrom, validTo?, baseRent, serviceAdvance, source, note)`
  - `serviceAdvance` = co tenant měsíčně dává na SVJ-služby (bez deductible části)
  - `source` ∈ `"initial" | "addendum" | "change"`
- `ContractUtility(contractId, kind, validFrom, validTo?, monthlyAdvance, note)`
  - `kind` ∈ `"electricity" | "gas" | "internet" | "water" | "other"`
  - 0–N řádků per contract
- `PropertyServiceTariff(propertyId, validFrom, validTo?, totalSvjAdvance, deductibleAmount, deductibleNote, note)`
  - `totalSvjAdvance` = co landlord platí SVJ měsíčně dle EL
  - `deductibleAmount` = část NEjdoucí za nájemcem (FO + případně další odečitatelné)
  - `deductibleNote` = textový výčet složek (z `slozky_fond_oprav` z sheetu)

### 4.4 Platby
- `Payment(orgId, contractId?, amount, paidAt, counterparty, counterpartyAccount, externalId?, statementRef?, source, description?, note?, importedAt)`
  - `externalId` UNIQUE per `(orgId, externalId)` — idempotentní reimport
  - `source` ∈ `"bank" | "manual"`
  - Nullable `contractId` = inbox

### 4.5 Vstupy nákladů
- `CostStatement(orgId, propertyId, kind, periodFrom, periodTo, totalAmount, adjustmentAmount, adjustmentNote?, documentRef?, issuedAt?, note?)`
  - `kind` stejný enum jako `ContractUtility.kind` + `"services"` pro SVJ
  - `adjustmentAmount` (signed): + přičíst (solar credit u elektřiny zpět protože placeno z FO), − odečíst (FO porce ze SVJ celku)
  - `adjustmentNote`: textové vysvětlení adjustmentu (pro audit / přehled)
  - **Reconciliable cost = `totalAmount + adjustmentAmount`** — skill vkládá hotová čísla, backend jen sčítá
  - `PropertyServiceTariff.deductibleAmount` zůstává **jen informační** (pro UI a validaci `ContractTerms.serviceAdvance ≈ totalSvjAdvance − deductibleAmount`); do reconciliace přímo nevstupuje

### 4.6 Výstup
- `Reconciliation(orgId, contractId, periodFrom, periodTo, status, computedAt, note?)`
  - `status` ∈ `"draft" | "finalized"`
- `ReconciliationItem(reconciliationId, kind, actualCost, paid, difference)`
  - `difference = paid - actualCost` (kladné = vrátit nájemci)

## 5. Klíčové výpočty (v service vrstvě)

### 5.1 Plán plateb (per měsíc)
```
expected(contract, month) =
    ContractTerms.baseRent (valid in month)
  + ContractTerms.serviceAdvance (valid in month)
  + Σ ContractUtility.monthlyAdvance (valid in month, across all kinds)
```

### 5.2 Alokace přijatých plateb (per měsíc)
```
allocate(contract, month):
  received = Σ Payment.amount where contractId=contract, paidAt in month
  expected = expected(contract, month) per breakdown
  apply received in order: baseRent → serviceAdvance → utilities (kind order: electricity, gas, internet, water, other)
  returns: { baseRentPaid, servicePaid, utilityPaid: {kind: amount}, deficit, surplus }
```

### 5.3 Reálné náklady (per kind v období)
```
actualCost(property, kind, periodFrom, periodTo):
  -- Skill při vkládání CostStatement zapíše:
  --   * totalAmount už proporcionální na relevantní období
  --   * adjustmentAmount signed (solar credit, FO odečet ze SVJ, …)
  -- Backend jen sčítá:
  return Σ (CostStatement.totalAmount + CostStatement.adjustmentAmount)
         where property=p, kind=k, period in [periodFrom, periodTo]
```

### 5.4 Vyúčtování (compute)
```
compute(contract, periodFrom, periodTo):
  for each kind in distinct(contract utilities ∪ "services"):
    paid = Σ allocate(contract, month).{servicePaid|utilityPaid[kind]} over months
    actual = actualCost(property, kind, periodFrom, periodTo)
    diff = paid - actual
    append ReconciliationItem(kind, actual, paid, diff)
  return Reconciliation with items
```

## 6. API (REST + MCP parita)

Každý zdroj má stejné operace přes REST i MCP. MCP tool = thin Zod-validated wrapper kolem REST endpointu.

### 6.1 Zdroje
| REST path | MCP tool | Operace |
|---|---|---|
| `/api/properties` | `properties.*` | list, get, create, update |
| `/api/tenants` | `tenants.*` | list, get, create, update |
| `/api/contracts` | `contracts.*` | list, get, create, update; nested: `terms.*`, `utilities.*` |
| `/api/property-tariffs` | `property_tariffs.*` | list (per property), create, update |
| `/api/payments` | `payments.*` | list, get, create (single/batch), assignToContract, update, delete |
| `/api/cost-statements` | `cost_statements.*` | list, get, create, update |
| `/api/reconciliations` | `reconciliations.*` | list, get, compute, finalize |
| `/api/api-tokens` | (UI only) | list, create, revoke |

### 6.2 Auth
- UI: cookie session (better-auth)
- MCP: `Authorization: Bearer <token>` header; middleware ověří `ApiToken.tokenHash` → naplní `req.context.{userId, orgId, membership, allowedPropertyIds?}`
- All services přijímají `context` a filtrují všechny query podle `orgId` (+ `allowedPropertyIds` pokud člen)

### 6.3 Idempotence
- `POST /api/payments` s `externalId` — pokud už existuje pro org, vrátí existující záznam (HTTP 200) místo 409. Skill může batch-importovat opakovaně bez duplicit.

## 7. MCP konfigurace

### 7.1 Lokální stdio (MVP)
`.mcp.json` ve workspace, kde David pouští Claude Code. MCP server volá lokálně běžící Hono backend (`pnpm dev`), takže server musí běžet souběžně:
```json
{
  "mcpServers": {
    "rental": {
      "command": "npx",
      "args": ["tsx", "mcp/index.ts"],
      "env": {
        "RENTAL_API_URL": "http://localhost:3000",
        "RENTAL_API_TOKEN": "..."
      }
    }
  }
}
```

### 7.2 Remote (později)
- Stejný kód, `transportType: "httpStream"` při startu
- Token mgmt: stejný `ApiToken` mechanismus (Bearer)
- Mount na `/mcp` ve stejném Hono procesu

## 8. Deployment

### 8.1 Local dev
```
pnpm dev              # spustí Vite + Hono server paralelně (jako VMP_TEST)
pnpm db:migrate       # Drizzle migrace
pnpm mcp              # spustí stdio MCP server (pro testování)
```
DB = `./data/rental.sqlite` (libSQL file).

### 8.2 Docker
- `Dockerfile`: multi-stage build, výstup = single Node image
- DB v `/data` volume
- `docker-compose.yml` pro local end-to-end (app + volume)

### 8.3 Vercel
- Hono Vercel adapter v `server/vercel.ts`
- DB: Turso (libSQL hosted) přes env var `DATABASE_URL`
- MCP zatím není deployed — local stdio only v MVP

## 9. Co MVP záměrně neobsahuje

- PDF generátor vyúčtování (skilly si výstup vygenerují z JSON)
- Email integrace
- Tracking toku kauce (jen informativní pole na `Contract`)
- Notifikace o opožděných platbách
- Reporty/grafy (mimo prosté tabulky)
- Vícejazyčnost (jen CZ)
- Audit log (kdo co změnil) — `createdAt`/`importedAt` stačí
- Soft delete / verze entit (kromě SCD2 temporálních)
- Migration tool ze sheetu (data se naplní postupně přes MCP)

## 10. Otevřené body / rizika

- **Proporční počítání období:** Pokud SVJ vyúčtování pokrývá 1.1.–31.12. a smlouva začíná 20.9., skill vkládající `CostStatement` musí spočítat proporci dní → finální číslo. Backend přijímá hotové číslo. Pokud se to ukáže příliš křehké, refactor na backend (přidat `prorationBasis` nebo store full + period a počítat při reconciliaci).
- **Změna `PropertyServiceTariff` mid-period:** Reconciliace musí integrovat přes platná období (sum over months × deductible_for_that_month). Implementace v service vrstvě s unit testy.
- **Více plateb v jednom měsíci / split měsíce:** Alokace bere všechny platby v měsíci sumárně podle `paidAt`. Pokud platba zaplatí 2 měsíce najednou, user ji rozdělí na 2 záznamy s upraveným `paidAt`. Explicitní pole „za který měsíc je platba" (`appliedToMonth`) zatím nemáme — pokud se ukáže potřeba, přidá se. Service vrstva má utility pro split.
- **Token revocation:** Při revokaci `ApiToken` musí MCP klient na nový token přejít manuálně. Žádný refresh flow v MVP.

## 11. Test strategy

- **Unit testy** v `core/services/*.test.ts` — temporální resolver, alokační pravidlo, reconciliace math
- **Integrační testy** v `server/routes/*.test.ts` — proti in-memory libSQL
- **E2E vyúčtování:** sestaví scénář z reálných čísel sheetu (Kolčavka 2024) a porovná výsledek s `Vyuctovani 2024` (rozdíl 693 Kč)

## 12. Postupné fáze (high-level)

Detailní implementační plán následuje v separátních dokumentech (writing-plans skill). Plány jsou rozdělené tak aby každý produkoval samostatně fungující/testovatelný software:

1. **Plan 1** — Skeleton + Auth + Multi-tenancy (Vite+Hono+Drizzle+libSQL+better-auth, User/Org/Membership/PropertyAccess/ApiToken, `/api/me`)
2. **Plan 2** — Core domain + Temporal (Property s `reconciliationSkill`, Tenant, Contract, ContractTerms, ContractUtility, PropertyServiceTariff)
3. **Plan 3** — Payments + CostStatement (idempotentní import, adjustmentAmount)
4. **Plan 4** — Reconciliace service + REST + **E2E <property-name-a> 2024 (<tenant-name>, period 20.09.–31.12.2024, expected diff 693 Kč)** přes REST volání proti backendu
5. **Plan 5** — MCP server (fastmcp stdio) + default reconciliation skill template v `docs/skills/templates/` + **replay <property-name-a> 2024 přes MCP tooly** (same scenario as Plan 4, validates MCP layer correctness)
6. **Plan 6** — UI (React+Tailwind+shadcn dashboard + CRUD) + Chrome MCP UI smoke tests (auth flow, dashboard render, CRUD happy paths)
7. **Plan 7** — Comprehensive unit test coverage přes agent team (parallel subagenty per service module: temporal resolver edge cases, allocation rule cornery, reconciliation math drift, idempotence stress, scope leak prevention)

Deploy (Docker + Vercel/Turso) **zatím není v scopu** — projekt běží lokálně přes `pnpm dev` + libSQL soubor. Hosted varianta odložena.

---

## 13. Skill architecture

Per-property výpočetní pravidla **nežijí v DB ani v backend kódu** — žijí jako skilly v uživatelově skill repu (`~/.claude/skills/` nebo per-project `.claude/skills/`). Backend drží jen referenci.

### 13.1 Princip „LLM ≠ kalkulačka"

Veškerá aritmetika (solar credit, FO odečet, proporce dní, agregace) MUSÍ být v deterministickém kódu uvnitř skillu. LLM dělá:
- **Extrakci** strukturovaných dat z PDF/CSV (volný text → JSON)
- **Orchestraci** (volá skripty, volá MCP, prezentuje výsledek)

LLM **nikdy nesmí** sečíst, vynásobit nebo proporcionálně přepočíst v hlavě. Když chce výsledek, volá skript v `scripts/`. Tato instrukce je explicitně v promptu každého reconciliation skillu.

### 13.2 Struktura reconciliation skillu (template)

`docs/skills/templates/rental-default-reconciliation/` poskytuje šablonu:

```
SKILL.md                  ← "udělej vyúčtování za rok X pro property Y" workflow
README.md                 ← jak template naklonovat a customizovat per property
_extractors/
  svj.md                  ← jak parsovat SVJ vyúčtování PDF (per-property semantika)
  electricity.md          ← jak parsovat el. fakturu (per-property formát)
  bank.md                 ← jak parsovat bankovní výpis
scripts/                  ← deterministická matika + parsery
  README.md               ← konvence: jeden compute<Kind>.ts per typ, vždy s testem
  example-electricity.ts  ← vzorový no-op skript s komentáři
  example-electricity.test.ts
fixtures/
  README.md               ← konvence: jeden {year}.json per rok se vstupy + očekávanými výstupy
```

Uživatel pro konkrétní property naklonuje template, customizuje:
- `_extractors/*.md` — jak LLM vytáhne strukturovaná data z konkrétního formátu (např. „pole 'Fond oprav' najdeš na str. 3 v sekci Skutečné náklady")
- `scripts/*.ts` — funkce co berou parsovaný vstup + dělají matiku
- `scripts/*.test.ts` — **povinné** regression fixtures
- `fixtures/*.json` — golden vstupy a očekávané výstupy

### 13.3 Workflow vyúčtování přes skill

```
User: "Udělej vyúčtování za 2025 pro Kolčavku"
  ↓
Claude → MCP get_property(propertyId)
     ← { name, reconciliationSkill: "kolcavka-reconciliation" }
  ↓
Claude invokuje "kolcavka-reconciliation" (main skill)
  ↓
Skill workflow:
  1. Shromáždí vstupy (SVJ PDF, faktury el., výpis) přes user dotazy
  2. Pro každý dokument: _extractors/* → strukturovaná data
  3. scripts/* → deterministicky spočítá adjustmenty (solar, FO odečet, proporce)
  4. Spustí scripts/*.test.ts (regression gate). FAIL → abort + report
  5. MCP create_cost_statement(...) per dokument (s documentRef = SHA256 pro idempotenci)
  6. MCP record_payments(...) z výpisu (s externalId)
  7. MCP compute_reconciliation(contractId, period)
  8. Audit trail v adjustmentNote (lidsky čitelný breakdown formule)
  9. Prezentuje user shrnutí + audit ke schválení
```

### 13.4 Garance správnosti

- **Regression gate**: skill před každým MCP zápisem spustí `scripts/*.test.ts` proti svým fixtures. Při FAIL aborts a požádá uživatele.
- **Audit trail**: `CostStatement.adjustmentNote` obsahuje lidsky čitelný breakdown formule. Příklad: `"Electricity +431 Kč = solar credit (FO-financed) = (22+19) KWh × 5.32 CZK/KWh × proration 103/365. Source: PDF p.3 'Elektřina ze solárního zdroje'"`.
- **Idempotence**: `CostStatement.documentRef = SHA256(source_file)`. Skill před zápisem zkontroluje že stejný hash v DB ještě není.
- **Defaultní skill**: `rental-default-reconciliation` má `scripts/` s no-adjustment pravidly (totalAmount = bill, adjustment = 0 kromě SVJ kde se odečte FO portion z `PropertyServiceTariff.deductibleAmount × měsíce`).

### 13.5 Co backend NEDĚLÁ

- Neukládá výpočetní pravidla (žádný `PropertyConfig` JSON sloupec, žádné rules tabulky)
- Nepoužívá skill kód (nečte ze skillu, neexekuuje skill scripty)
- Neví jak vypadá SVJ PDF / el. faktura / bank výpis — vidí jen finální strukturovaná čísla
- Backend zajišťuje **datovou integritu** (constraints, idempotence, scope) a **reconciliation math** (sum, allocation), nikoli per-property workflow

---
