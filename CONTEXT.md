# Správa pronájmu

Domain glossary for the Czech residential rental-management app: one landlord's leases, the payments they receive and the annual settlement of advances against real costs. This file is the source of truth for wording in the UI, code, MCP tool descriptions and the agent plugin skills (`agent-plugin/skills/`). When a word here disagrees with what you are about to write, this file wins; when this file is wrong, fix it here first.

Each entry gives the Czech UI term, the code identifier(s), what it is, and the words to avoid.

## Writing rules

- **The UI never shows API field names.** No `baseRent`, `serviceAdvance`, `paymentAppliesTo` or enum values like `next` on screen. Users see the Czech term from this file.
- **Explanations go into tooltips**, not into labels or extra paragraphs. A label is the bare term; the `Hint` next to it says what it means and why it matters.
- **No em-dashes** in UI text, docs, skills or changelogs. Use a plain hyphen or a new sentence.
- **Use the legal terms** of Czech tenancy law (občanský zákoník): pronajímatel, nájemce, nájem. Colloquial forms are listed under _Avoid_.
- **Money is shown in Kč**, formatted for `cs-CZ`, and stored as haléře (see Money).
- **No real names, addresses or amounts** in examples, tests or docs. Use `<placeholder>` style.

## Parties and access

**Pronajímatel** (landlord; the signed-in user acting through their organizace):
The owner who lets the nemovitost and receives nájem.
_Avoid_: majitel, vlastník, landlord in Czech text

**Nájemce** (`tenant`, `tenantId`):
The person who rents the nemovitost under a pronájem and pays the měsíční předpis.
_Avoid_: nájemník, nájemníci

**Nemovitost** (`property`, `propertyId`):
The flat, house or garage being let; it carries its evidenční list and vyúčtování nákladů.
_Avoid_: byt (as a generic term), jednotka, objekt

**Organizace** (`organization`, `orgId`):
The account that owns all data; every record belongs to exactly one organizace and is never looked up across them.
_Avoid_: firma, tenant (in the SaaS sense, it collides with nájemce)

**Členství** (`membership`, `role`: `owner` | `member`):
A user's place in an organizace, optionally limited to some nemovitosti (`property_access`, surfaced as `allowedPropertyIds`; null means all).
_Avoid_: uživatel organizace, účet

## Lease

**Pronájem / smlouva** (`contract`, `contractId`, `startDate`, `endDate`):
The lease between pronajímatel and one nájemce for one nemovitost; "pronájem" names it in navigation and lists, "smlouva" names the signed document.
_Avoid_: kontrakt, nájemní vztah, lease

**Podmínky** (`contract_terms`, SCD2 rows with `validFrom` / `validTo`):
The money and timing rules of a pronájem valid over a date range; the current podmínky are the row without an end date.
_Avoid_: tarif (reserved for the evidenční list), nastavení smlouvy

**Změna / dodatek / počáteční** (`contract_terms.source`: `change` | `addendum` | `initial`):
How a row of podmínky came to be: počáteční at signing, dodatek when a signed amendment changes them, změna for any other dated change; a new row always closes the previous one and never rewrites its start date.
_Avoid_: úprava (reserved for cost statements), verze, revize

**Nájem** (`baseRent`, kind `rent`):
The monthly rent that is the pronajímatel's income and is never settled against costs.
_Avoid_: nájemné, činže

**Záloha na služby SVJ** (`serviceAdvance`, kind `services`, UI kind label "Služby (SVJ)"):
The monthly advance the nájemce pays towards building services, settled once a year against the SVJ's real costs.
_Avoid_: poplatky, služby (alone, when the advance is meant)

**Energie / zálohy na energie** (`contract_utility`, `kind`: `electricity` | `gas` | `water` | `internet` | `other`, `monthlyAdvance`):
Monthly advances for utilities the nájemce pays through the pronajímatel, each kind with its own SCD2 history and its own annual settlement. UI labels: Elektřina, Plyn, Voda, Internet, Ostatní.
_Avoid_: utility, média

**Měsíční předpis** (expected monthly total: nájem + záloha na služby SVJ + zálohy na energie):
What the nájemce owes for one month under the podmínky valid then, prorated for a partial first or last month.
_Avoid_: platba (that is money received), splátka

**Předepsáno** (`effectiveExpected` in the payment breakdown):
The měsíční předpis after the month's srážka nájmu, i.e. what the nájemce really had to pay that month.
_Avoid_: očekáváno, plán (except in the breakdown tooltip context)

**Srážka nájmu** (`rent_reduction`, `forMonth`, `amount`, `reason`):
A one-off reduction of one month's nájem, typically when the nájemce paid a repair that belongs to the pronajímatel; it lowers nájem only, never the zálohy.
_Avoid_: sleva, odpočet, kompenzace

**Splatnost** (`paymentDueDay`):
The day of the month by which the měsíční předpis is due; a payment after it is "po splatnosti".
_Avoid_: datum platby, termín platby

**Platba za aktuální / následující měsíc** (`paymentAppliesTo`: `current` | `next`, UI "Aktuální měsíc" / "Následující měsíc (předem)"):
Whether a payment due in a month pays that month or the next one in advance; it lives on the podmínky, so a dodatek can change it.
_Avoid_: "current" / "next" on screen, režim platby

**Kauce** (`securityDeposit`):
The security deposit the nájemce paid at the start, held by the pronajímatel and outside every settlement.
_Avoid_: jistota, depozit, záloha (záloha always means a monthly advance)

## Payments

**Přijatá platba** (`payment`, `amount`, `paidAt`, `source`: `bank` | `manual`):
Money actually received from a nájemce, assigned to one pronájem or still waiting for assignment.
_Avoid_: transakce (reserved for the bank's raw record), úhrada as a noun for the record

**Měsíční rozpis** (`payment-breakdown`, `contracts_payment_breakdown`):
The month-by-month view of a pronájem: předpis, srážka, předepsáno, which platby landed on the month and how they were split.
_Avoid_: přehled plateb, výpis

**Rent-first rozdělení** (allocation, `core/lib/allocation.ts`):
Within a month a platba covers nájem first, then the záloha na služby SVJ, then energie, so any shortfall lands on the zálohy and not on nájem.
_Avoid_: poměrné rozdělení

**Přirozený měsíc** (`naturalMonth`):
The month a platba is for, derived from its date and the platba za aktuální / následující měsíc rule valid then.
_Avoid_: účetní měsíc

**Přiřazení plateb k měsícům** (FIFO matching, `core/lib/payment-matching.ts`):
Each platba lands whole on its přirozený měsíc and only moves to an earlier month that is completely unpaid; one platba is never split across months and a surplus stays on its month.
_Avoid_: párování (reserved for bank pairing), alokace (for this step)

**Párování plateb** (`payment_matching_rule`, `bank_integration`, `bank_transaction`):
Automatic assignment of incoming bank transakce to a pronájem by its rule: protistrana's account, variabilní / konstantní / specifický symbol and an amount range, every filled criterion must hold.
_Avoid_: matching, mapování

**Bankovní integrace** (`bank_integration`, `kind`: `kb_email`):
A mailbox the app reads for the bank's payment notifications, which become transakce.
_Avoid_: napojení na banku, bankovní API

**Transakce** (`bank_transaction`, statuses shown as Nespárováno, Spárováno, Více pravidel, Možný duplikát, Ignorováno, Nezpracováno):
One raw incoming bank movement before or after it becomes a přijatá platba.
_Avoid_: platba (until it is assigned)

**Nepřiřazené platby** (transakce with no `paymentId`):
The inbox of transakce that párování could not place, waiting for the pronajímatel to assign or ignore them.
_Avoid_: nespárované platby, chybějící platby

## Costs and settlement

**Evidenční list / předpis SVJ** (`property_service_tariff`, SCD2 with `validFrom` / `validTo`):
The SVJ's statement of a nemovitost's monthly advances, with its own history per nemovitost.
_Avoid_: tarif in UI text, rozpis SVJ

**Zálohy SVJ celkem** (`totalSvjAdvance`):
The full monthly advance the SVJ charges the pronajímatel for the nemovitost.
_Avoid_: záloha SVJ (ambiguous with the nájemce's záloha)

**Odečitatelná část** (`deductibleAmount`, `deductibleNote`, UI "Odečitatelné"):
The part of the předpis SVJ that the pronajímatel bears and never settles with the nájemce, such as fond oprav, odměny výboru or pojištění domu.
_Avoid_: FO odečet in UI, srážka

**K vyúčtování** (`totalSvjAdvance − deductibleAmount`):
The SVJ advance after the odečitatelná část; this is what the nájemce's záloha na služby SVJ is compared against.
_Avoid_: čistá záloha

**Vyúčtování nákladů** (`cost_statement`, `kind`, `periodFrom` / `periodTo`, `totalAmount`):
The real costs for one kind over a period as billed by the SVJ or a supplier, attached to a nemovitost.
_Avoid_: výkaz nákladů, faktura, cost statement in Czech text

**Úprava** (`adjustmentAmount`, `adjustmentNote`):
A signed amount that changes a vyúčtování nákladů before comparison with the zálohy, with a note showing how it was computed.
_Avoid_: korekce, oprava, změna (reserved for podmínky)

**Doklad** (`documentRef`):
A link or file path to the source document behind a record.
_Avoid_: příloha, soubor

**Vyúčtování nájemci** (`reconciliation`, `reconciliation_item`):
The annual settlement for one pronájem that compares what the nájemce paid on each kind against the real costs and yields one celkový rozdíl.
_Avoid_: roční zúčtování, reconciliace, vyrovnání

**Návrh / finalizováno** (`reconciliation.status`: `draft` | `finalized`):
A návrh can be recomputed or deleted; finalizováno freezes the stored totals as what was agreed with the nájemce.
_Avoid_: koncept, uzavřeno

**Období vyúčtování** (`reconciliation.periodFrom` / `periodTo`):
The range the vyúčtování nájemci covers, usually a calendar year.
_Avoid_: účetní období

**Období párování plateb** (`matchPeriod` per kind):
The months whose platby count for one kind; it follows the vyúčtování nákladů that start inside the období vyúčtování and shifts one month forward when the previous statement already owns the boundary month.
_Avoid_: období plateb, matchPeriod on screen

**Rozdíl / celkový rozdíl** (`difference`, sum over items):
Paid minus real cost per kind and in total; positive means "vrátit nájemci" (přeplatek), negative means "nájemce doplácí" (nedoplatek), zero is "vyrovnáno".
_Avoid_: saldo, bilance

## Everything else

**Připomínka / termín** (`reminder`, `dueDate`, `doneAt`):
A dated to-do of the pronajímatel, optionally tied to a pronájem or nemovitost.
_Avoid_: úkol, upozornění, notifikace

## Money

**Haléře** (every `*_haler` column, every amount in the API and MCP):
All money is stored and transmitted as whole haléře (Kč × 100), never as a decimal; the UI converts to Kč only for display and input.
_Avoid_: floats, koruny in stored values

## Flagged ambiguities

- **Nájemník leftovers** remain outside the UI: `server/mcp/handler.ts` (MCP server instructions), `agent-plugin/skills/rocni-vyuctovani/SKILL.md`, `agent-plugin/skills/smlouvy/SKILL.md`, `README_CZ.md`, and a historical entry in `mcp/CHANGELOG.md`.
