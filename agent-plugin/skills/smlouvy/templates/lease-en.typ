// ════════════════════════════════════════════════════════════════════════════
// lease-en — Residential Lease Agreement (Sec. 2235 et seq. of Act No. 89/2012
//            Coll., the Civil Code), ENGLISH
//
// Vytvořeno 4. 9. 2026 jako anglický protějšek `lease-cs.typ` (stejná struktura
// článků, stejné právní ukotvení). Určeno pro zahraniční nájemce.
//
// ── ODCHYLKY OD lease-cs ────────────────────────────────────────────────────
//
// 1. {{landlords}} je POLE, ne jeden pronajímatel — jednotka bývá v SJM,
//    na smlouvě musí být oba manželé. Při >1 pronajímateli článek 1 odst. 1
//    sází "joint marital property (společné jmění manželů)" místo
//    "exclusive owner".
// 2. Nájemce má navíc volitelné pole `idDoc` (cestovní doklad) — u cizince
//    je rodné číslo/OP nepoužitelné, identifikuje se pasem.
// 3. Článek 3 má {{lease.renewalNoticeDate}} — konkrétní datum, dokdy lze
//    oznámit nezájem o prodloužení (lease-cs ho nechává neurčité).
// 4. Úrok z prodlení: čl. 5 odst. 5 cituje § 1970 OZ + NV č. 351/2013 Sb.,
//    ne NV č. 142/1994 Sb. jako lease-cs. Poplatek z prodlení podle 142/1994
//    se na nájem bytu už nepoužije — 351/2013 je platná úprava.
// 5. Článek 9 má navíc odstavec o JAZYKU A ROZHODNÉM PRÁVU — smlouva je
//    jen anglicky, řídí se českým právem, strany potvrzují, že jazyku rozumí.
//    Bez toho je u cizojazyčné smlouvy riziko sporu o srozumitelnost.
//
// ── SPOLEČNÉ s lease-cs (nesahat) ───────────────────────────────────────────
//
// - PENÍZE V HALÉŘÍCH, sufix `Hal`: {{terms.baseRentHal}} = <částka×100>,
//   např. 1000000. Šablona sází "10,000 CZK" i "in words: ten thousand
//   Czech crowns" — z formátovaného stringu to nejde.
// - DATUMY "YYYY-MM-DD" jako v MCP; šablona je sází "1 January 2026".
// - {{landlords}}, {{tenants}}, {{property.accessories}}, {{attachments}},
//   {{partialFirst}}, {{inflation}} se nahrazují CELÝM Typst literálem.
//   Poslední dva se vypínají hodnotou `none`. Tvar viz lease-en.example.json.
//
//  Po podpisu zpět do MCP: contracts_create → contract_terms_add
//  (source "initial", documentRef = cesta k PDF) → contract_utilities_add.
// ════════════════════════════════════════════════════════════════════════════

#let vars = (
  // pole, jeden a více pronajímatelů (SJM = oba manželé):
  // ((name: .., dob: .., address: ..), ..)
  landlords: {{landlords}},
  bankAccount: "{{bankAccount}}",
  // variabilní symbol pro párování platit, nebo none (ostatní nemovitosti
  // se párují podle účtu plátce a rozsahu částky, VS nepoužívají)
  bankVs: {{bankVs}},
  // adresa pro doručování oznámení na straně pronajímatele, nebo none
  noticeEmail: {{noticeEmail}},

  // pole, jeden a více nájemců:
  // ((name: .., dob: .., address: .., idDoc: .. | none), ..)
  tenants: {{tenants}},

  property: (
    unitNumber: "{{property.unitNumber}}",
    floor: "{{property.floor}}",                 // "the ground floor"
    buildingNumbers: "{{property.buildingNumbers}}",
    parcelNumbers: "{{property.parcelNumbers}}",
    municipality: "{{property.municipality}}",
    cadastre: "{{property.cadastre}}",
    lvNumber: "{{property.lvNumber}}",
    cadastralOffice: "{{property.cadastralOffice}}",
    layout: "{{property.layout}}",               // "<dispozice>, approx. <n> m²"
    accessories: {{property.accessories}},       // ("a cellar ..",) nebo ()
    maxOccupants: {{property.maxOccupants}},
  ),

  lease: (
    startDate: "{{lease.startDate}}",
    endDate: "{{lease.endDate}}",
    termText: "{{lease.termText}}",              // "one year"
    renewalText: "{{lease.renewalText}}",        // "one year"
    renewalNoticeDate: "{{lease.renewalNoticeDate}}",
  ),

  deposit: (
    amountHal: {{deposit.amountHal}},
    dueDate: "{{deposit.dueDate}}",
  ),

  terms: (
    baseRentHal: {{terms.baseRentHal}},
    serviceAdvanceHal: {{terms.serviceAdvanceHal}},
    paymentDueDay: {{terms.paymentDueDay}},
  ),

  // ((kind: "electricity", monthlyAdvanceHal: <záloha×100>), ..) nebo ()
  utilities: {{utilities}},

  servicesIncluded: "{{servicesIncluded}}",
  // věta/věty o zúčtovacích obdobích; u víc období se sem vloží celý popis
  settlementText: "{{settlementText}}",

  // lhůty po skončení nájmu (čl. 6 odst. 15)
  handback: (graceDays: {{handback.graceDays}},
             storageMonths: {{handback.storageMonths}}),

  // poměrná část za neúplný první měsíc, nebo none
  partialFirst: {{partialFirst}},

  // inflační doložka (čl. 5 odst. 6–9), dohoda dle § 2248 OZ, nebo none.
  inflation: {{inflation}},

  repairs: (perRepairLimitHal: {{repairs.perRepairLimitHal}},
            annualLimitPerM2Hal: {{repairs.annualLimitPerM2Hal}}),

  copies: "{{copies}}",                          // "two"
  attachments: {{attachments}},
  signLocation: "{{signLocation}}",              // "Prague"
  signDate: "{{signDate}}",
)


// ─── helpers ────────────────────────────────────────────────────────────────

#let _ones = ("zero", "one", "two", "three", "four", "five", "six", "seven",
              "eight", "nine")
#let _teens = ("ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
               "sixteen", "seventeen", "eighteen", "nineteen")
#let _tens = ("", "", "twenty", "thirty", "forty", "fifty", "sixty",
              "seventy", "eighty", "ninety")

#let _under-thousand(n) = {
  let parts = ()
  let h = calc.quo(n, 100)
  let r = calc.rem(n, 100)
  if h > 0 { parts.push(_ones.at(h) + " hundred") }
  if r >= 20 {
    let u = calc.rem(r, 10)
    if u > 0 { parts.push(_tens.at(calc.quo(r, 10)) + "-" + _ones.at(u)) }
    else { parts.push(_tens.at(calc.quo(r, 10))) }
  } else if r >= 10 {
    parts.push(_teens.at(r - 10))
  } else if r > 0 {
    parts.push(_ones.at(r))
  }
  parts.join(" ")
}

// číslo slovy, anglicky
#let in-words(n) = {
  if n == 0 { return "zero" }
  let out = ()
  let mil = calc.quo(n, 1000000)
  let tho = calc.quo(calc.rem(n, 1000000), 1000)
  let uni = calc.rem(n, 1000)
  if mil > 0 { out.push(_under-thousand(mil) + " million") }
  if tho > 0 { out.push(_under-thousand(tho) + " thousand") }
  if uni > 0 { out.push(_under-thousand(uni)) }
  out.join(" ")
}

// haléře → "10,000"
#let amount(hal) = {
  let cl = str(calc.quo(hal, 100)).clusters()
  let res = ""
  let c = 0
  let i = cl.len()
  while i > 0 {
    res = cl.at(i - 1) + res
    c += 1
    i -= 1
    if calc.rem(c, 3) == 0 and i > 0 { res = "," + res }
  }
  res
}

// haléře → "ten thousand Czech crowns"
#let words-czk(hal) = {
  let n = calc.quo(hal, 100)
  in-words(n) + " Czech " + (if n == 1 { "crown" } else { "crowns" })
}

// Tučně se sází JEN kalendářní datum, které zakládá povinnost (začátek a konec
// nájmu, lhůta pro oznámení, splatnost, účinnost valorizace) — ne data narození
// ani platnost dokladu, a ne délky lhůt („30 days", „three-month"). Kdyby se
// zvýraznilo všechno, přestane emfáze fungovat.
#let _months = ("January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November",
                "December")

// "2026-01-01" → "1 January 2026"
#let day(s) = {
  if s == none { return "" }
  let p = s.split("-")
  // nezalomitelné mezery — datum nesmí přetéct na další řádek
  str(int(p.at(2))) + "\u{00A0}" + _months.at(int(p.at(1)) - 1) + "\u{00A0}" + p.at(0)
}

// datum tučně — viz komentář u _months
#let dayb(s) = strong(day(s))

// (month: 4, day: 1) → "1 April"
#let _day-in-year(t) = str(t.day) + "\u{00A0}" + _months.at(t.month - 1)

// 2 → "2 %", 2.5 → "2.5 %"
#let _pct(x) = {
  let s = if type(x) == int { str(x) } else { str(x) }
  s + "\u{00A0}%"
}

#let _utility-name = (
  electricity: "electricity",
  gas: "gas",
  internet: "internet connection",
  water: "water",
  heating: "heating",
)

#let _article(numeral, title, body) = {
  v(0.7em)
  align(center)[
    *Article #numeral*
    #v(0.1em)
    *#title*
  ]
  v(0.4em)
  body
}

#let _item(n, body) = block(below: 0.5em)[
  #grid(
    columns: (1.8em, 1fr),
    column-gutter: 0.3em,
    align(top)[#n.],
    body,
  )
]

#let _let(n, body) = block(below: 0.35em, inset: (left: 1.8em))[
  #grid(columns: (1.6em, 1fr), column-gutter: 0.3em, align(top)[#n\)], body)
]


// ─── document ───────────────────────────────────────────────────────────────

#let lease-agreement(d) = {
  set page(paper: "a4", margin: (top: 2.2cm, bottom: 2cm, left: 2.4cm, right: 2.4cm),
           numbering: "1")
  set text(font: "New Computer Modern", size: 10.5pt, lang: "en")
  set par(justify: true, leading: 0.6em, spacing: 0.9em, first-line-indent: 0pt)

  let t = d.terms
  let p = d.property
  let c = d.lease
  let dep = d.deposit
  let u = d.at("utilities", default: ())
  let nt = d.tenants.len()
  let nl = d.landlords.len()

  // "<záloha> CZK + <záloha> CZK for electricity + <záloha> CZK for internet connection"
  let adv-text = amount(t.serviceAdvanceHal) + "\u{00A0}CZK" + u.map(
    x => " + " + amount(x.monthlyAdvanceHal) + "\u{00A0}CZK for "
         + _utility-name.at(x.kind, default: x.kind)
  ).join("")

  let adv-total = t.serviceAdvanceHal + u.map(x => x.monthlyAdvanceHal).sum(default: 0)

  let occupants = if nt == 1 { "the Tenant" } else { "the Tenants" }
  let LL = if nl > 1 { "Landlords" } else { "Landlord" }
  let TT = if nt > 1 { "Tenants" } else { "Tenant" }
  let ll-verb = if nl > 1 { "are" } else { "is" }
  let tt-verb = if nt > 1 { "are" } else { "is" }
  let tt-has = if nt > 1 { "have" } else { "has" }
  let ll-has = if nl > 1 { "have" } else { "has" }
  // "5th" — ordinál se počítá tady, aby šel vysázet tučně jedním výrazem
  let due-ord = str(t.paymentDueDay) + (
    if t.paymentDueDay == 1 { "st" } else if t.paymentDueDay == 2 { "nd" }
    else if t.paymentDueDay == 3 { "rd" } else { "th" }
  )
  // pomocné "does/do" — u záporu se nesmí použít is/are ("is not remedy")
  let tt-does = if nt > 1 { "do" } else { "does" }
  // possessive: "Landlords'" vs "Landlord's" — #LLp samo vyrobilo
  // "Landlords's", proto vlastní proměnná
  let LLp = if nl > 1 { "Landlords'" } else { "Landlord's" }
  let TTp = if nt > 1 { "Tenants'" } else { "Tenant's" }
  // role pod podpisovou linkou je vždy v jednotném čísle
  let LLrole = "Landlord"
  let TTrole = "Tenant"

  // ── header: the parties ──
  [On the date set out below, the parties]

  v(0.6em)
  for (i, n) in d.landlords.enumerate() {
    if i > 0 { block(below: 0.5em)[and] }
    block(below: 0.5em)[
      *#n.name*, \
      born #day(n.dob), \
      permanent residence at #n.address
    ]
  }
  block(below: 0.5em)[
    #{
      if nl > 1 [(jointly the "*#LL*") on the one part]
      else [(the "*#LL*") on the one part]
    }
  ]

  block(below: 0.5em)[and]

  for (i, n) in d.tenants.enumerate() {
    if i > 0 { block(below: 0.5em)[and] }
    block(below: 0.5em)[
      *#n.name*, \
      born #day(n.dob), \
      residing at #n.address#{
        let doc = n.at("idDoc", default: none)
        if doc != none [, \ #doc]
      }
    ]
  }
  block(below: 0.5em)[
    #{
      if nt > 1 [(jointly the "*#TT*") on the other part]
      else [(the "*#TT*") on the other part]
    }
  ]

  v(0.6em)
  [have entered into this]
  align(center)[
    #text(size: 13pt, weight: "bold")[Residential Lease Agreement:] \
    #emph[(pursuant to Section 2235 et seq. of Act No. 89/2012 Coll., the Civil Code)]
  ]

  // ── art. 1 ──
  _article("1", "Subject of the Lease")[
    #_item(1)[
      #{
        if nl > 1 [
          The #LL own unit No. #p.unitNumber as their joint marital property
          (#emph[společné jmění manželů]), located on
        ] else [
          The #LL #ll-verb the exclusive owner of unit No. #p.unitNumber, located on
        ]
      } #p.floor of the residential building No. #p.buildingNumbers, forming part
      of the land plots No. #p.parcelNumbers, in the municipality of
      #p.municipality, cadastral district #p.cadastre, recorded on the title deed
      (#emph[list vlastnictví]) No. #p.lvNumber kept by #p.cadastralOffice
      (the "*Apartment*" or the "*Leased Premises*"). By this Agreement the #LL
      hand over to the #TT for lease the apartment #p.layout#{
        if p.at("accessories", default: ()).len() > 0 {
          ", together with " + p.accessories.join(", ")
        }
      }.
    ]
    #_item(2)[
      The #TT #tt-verb entitled to use the Apartment solely for the purpose of
      housing #occupants #{if nt > 1 [and the members of their households]
        else [and the members of the #TTp household]}. Use of the Apartment by
      other persons is not permitted.
    ]
    #_item(3)[
      The #TT #tt-verb obliged to use the Leased Premises with the care of
      a prudent manager and to comply with all safety, hygiene, fire-protection
      and other generally binding regulations and standards.
    ]
    #_item(4)[
      The Apartment is furnished and equipped as described in the handover
      protocol, which includes current photographic documentation.
    ]
  ]

  // ── art. 2 ──
  _article("2", "Members of the Tenant's Household")[
    The #LL grant the #TT and the members of #{if nt > 1 {"their"} else {"his or her"}}
    household consent to register permanent residence (#emph[trvalý pobyt]) at the
    Apartment for the duration of this Agreement. As of the date of termination of
    the lease, the #TT and the members of the household are obliged to deregister
    their permanent residence. Should they fail to do so, the #LL shall file
    a petition for cancellation of the permanent residence of those persons with
    the competent administrative authority. The costs associated with such
    administrative proceedings shall be borne by the #TT and may be drawn from the
    security deposit.
  ]

  // ── art. 3 ──
  _article("3", "Term of the Lease")[
    The lease is agreed for a fixed term of #c.termText, effective from
    #dayb(c.startDate) until #dayb(c.endDate). The term of the lease shall be
    automatically extended by a further #c.renewalText, and repeatedly thereafter,
    unless either party notifies the other in writing, no later than
    #dayb(c.renewalNoticeDate) in the case of the first extension and no later than
    three months before the end of the then-current term in the case of any
    subsequent extension, that it does not wish the lease to be extended.
  ]

  // ── art. 4 ──
  _article("4", "Handover and Acceptance of the Apartment")[
    #_item(1)[
      By signing this Agreement, the parties confirm that the Apartment is in
      a condition fit for the agreed purpose of use.
    ]
    #_item(2)[
      A handover protocol shall be drawn up recording the condition of the
      Apartment, including its equipment, meter readings and the number of keys
      handed over.
    ]
    #_item(3)[
      The #TT undertake#{if nt > 1 [] else [s]} to pay to the #LLp bank account
      No. *#d.bankAccount*#{
        let vs = d.at("bankVs", default: none)
        if vs != none [ (variable symbol *#vs*)]
      }, by #dayb(dep.dueDate), the amount of
      *#amount(dep.amountHal)\u{00A0}CZK* (in words: #words-czk(dep.amountHal))
      as a security deposit securing the rent and the payment of any other
      obligations arising in connection with the lease. The #LL shall return the
      security deposit to the #TT without undue delay after the termination of
      the lease, and in any event within one month, setting off any amounts the
      #TT owe#{if nt > 1 [] else [s]} to them. Pursuant to Section 2254(2) of the
      Civil Code, the #TT #tt-verb entitled to interest on the security deposit
      from the date on which it is provided, at least at the statutory rate; the
      #LL shall pay that interest together with the return of the security
      deposit. Payment of the security deposit is a condition for handover of the
      Apartment.
    ]
  ]

  // ── art. 5 ──
  _article("5", "Rent and Payments for Services Provided with the Use of the Apartment")[
    #_item(1)[
      The #TT #tt-verb obliged to pay the #LL the rent for the use of the Apartment,
      agreed in the amount of *#amount(t.baseRentHal)\u{00A0}CZK* (in words:
      #words-czk(t.baseRentHal)) per month. The rent is due by the
      *#due-ord* day of the month for which it is paid, to the #LLp bank account
      No. *#d.bankAccount*.#{
        let vs = d.at("bankVs", default: none)
        if vs != none [
          #" " When making any payment under this Agreement, the #TT shall quote
          the variable symbol (#emph[variabilní symbol]) *#vs* as the payment
          reference. This applies to the rent, the security deposit, the advance
          payments for Services and any amount arising from their annual
          settlement. The #LL identify payments by this variable symbol; a payment
          made without it may not be attributed to the #TT, and any resulting delay
          in attribution is at the #TTp risk.
        ]
      }#{
        let f = d.at("partialFirst", default: none)
        if f != none [
          #" " The rent for the period from #dayb(f.from) to #dayb(f.to), in the
          amount of *#amount(f.rent)\u{00A0}CZK*, is due by #dayb(f.dueDate) to
          the #LLp bank account, and its timely payment is a condition for
          handover of the Apartment.
        ]
      }
    ]
    #_item(2)[
      The #TT #tt-verb not entitled to claim a reduction of the rent during the
      term of the lease.
    ]
    #_item(3)[
      The parties have agreed on monthly advance payments for services provided
      with the use of the Apartment (the "*Services*") in the amount of
      #adv-text per month, i.e. *#amount(adv-total)\u{00A0}CZK* in total, due
      together with the rent to the bank account specified above. These advance
      payments cover the following Services: #d.servicesIncluded.
      #d.settlementText Any overpayment or underpayment resulting from
      a settlement is due within 14 days of that settlement being delivered to
      the #TT. On request, the #LL shall make the underlying statements and
      invoices available to the #TT.#{
        let f = d.at("partialFirst", default: none)
        if f != none [
          #" " The Services for the period from #dayb(f.from) to #dayb(f.to), in
          the amount of *#amount(f.services)\u{00A0}CZK*, are due by
          #dayb(f.dueDate) to the #LLp bank account, and their timely payment is
          a condition for handover of the Apartment.
        ]
      }
    ]
    #_item(4)[
      The #LL #ll-verb entitled to increase the advance payments for Services if
      the price or the scope of the relevant Service increases. The #LL shall
      notify the #TT of the new amount in writing, together with the reason for
      the change, at least 30 days before it takes effect. The #LL shall likewise
      reduce the advance payments if the price or the scope of the relevant
      Service decreases materially and on a lasting basis.
    ]
    #_item(5)[
      If the #TT fail#{if nt > 1 [] else [s]} to pay the rent or the Services
      within five days of their due date, the #TT #tt-verb obliged to pay the #LL
      default interest pursuant to Section 1970 of the Civil Code, in the amount
      set by Government Regulation No. 351/2013 Coll., as amended.
    ]
    #{
      let inf = d.at("inflation", default: none)
      if inf != none {
        let eff = _day-in-year(inf.effectiveFrom)
        _item(6)[
          Within the meaning of Section 2248 of the Civil Code, the parties have
          agreed on the following mechanism for increasing the rent (the
          "*indexation clause*"): the #LL #ll-verb entitled to unilaterally
          increase the rent with effect from *#eff* of each calendar year, for the
          first time with effect from *#eff #str(inf.firstYear)*, by the rate of
          inflation expressed as the increase in the average annual consumer
          price index for the immediately preceding calendar year, as published
          by the Czech Statistical Office. The basis for the calculation is the
          rent agreed under paragraph 1 of this Article, or the rent as last
          increased in this manner. The increased rent shall be rounded
          #inf.rounding.#{
            let th = inf.at("threshold", default: none)
            if th != none [
              #" " If the published rate of inflation does not reach
              #_pct(th), no increase of the rent shall take place in that
              calendar year.
            ]
          }#{
            let cp = inf.at("cap", default: none)
            if cp != none [
              #" " An increase of the rent under this paragraph shall not exceed
              #_pct(cp) in any one calendar year.
            ]
          }
        ]
        _item(7)[
          The #LL shall notify the #TT of an increase of the rent under paragraph
          6 in writing at least #str(inf.noticeDays) days before the day on which
          it takes effect; the notice shall state the published rate of inflation,
          the calculation and the new amount of the rent. If the #LL deliver#{if nl > 1 [] else [s]}
          the notice later, the rent increases from the first day of the calendar
          month following delivery of the notice.
        ]
        _item(8)[
          If the published rate of inflation is zero or negative, the rent remains
          unchanged; the procedure under paragraph 6 shall never reduce the rent.
          If the #LL do#{if nl > 1 [] else [es]} not apply an increase in
          a particular calendar year, that right does not lapse and may be
          exercised at any later time; however, the rent is always increased
          prospectively only, and the #LL #ll-verb not entitled to claim payment
          of the difference for the period before the day the increase takes
          effect.
        ]
        _item(9)[
          The provisions of paragraphs 6 to 8 constitute an agreement on
          increasing the rent within the meaning of Section 2248 of the Civil
          Code; the procedure under Section 2249 of the Civil Code shall not
          apply. This does not affect the right of the parties to agree on
          a different amount of rent by a written amendment to this Agreement.
          Increases of the advance payments for Services are governed by
          paragraph 4 of this Article.
        ]
      }
    }
  ]

  // ── art. 6 ──
  _article("6", "Rights and Obligations Associated with the Lease")[
    #_item(1)[
      The #TT #tt-verb entitled to use the Leased Premises in accordance with
      this Agreement.
    ]
    #_item(2)[
      The #TT #tt-verb obliged to maintain the Apartment at #{if nt > 1 {"their"} else {"his or her"}}
      own expense in a condition fit for ordinary use.
    ]
    #_item(3)[
      The #TT #tt-verb obliged to arrange and pay for minor repairs and the costs
      associated with the ordinary maintenance of the Apartment, to the extent set
      out in Article 7 of this Agreement.
    ]
    #_item(4)[
      The #TT #tt-verb obliged to notify the #LL in writing, without undue delay,
      of the need for repairs in the Apartment which the #LL #ll-verb to bear, and
      to allow the #LL to carry them out.
    ]
    #_item(5)[
      The #TT #tt-verb obliged to remedy and pay at #{if nt > 1 {"their"} else {"his or her"}}
      own expense any damage to the Leased Premises caused by
      #{if nt > 1 {"them"} else {"him or her"}} or by any other persons entering
      the premises with the consent or knowledge of the #TT. If the #TT
      #tt-does not remedy such damage within 15 days of the #LLp written notice,
      the #LL shall remedy the damage at the #TTp expense. The #TT #tt-verb then
      obliged to reimburse those costs to the #LL within 15 days of being
      presented with the relevant documents evidencing the amount of such expenses.
    ]
    #_item(6)[
      The #TT may carry out alterations to the Leased Premises only with the prior
      written consent of the #LL.
    ]
    #_item(7)[
      The #TT #tt-verb obliged to refrain from any conduct that would disturb or
      could jeopardise the exercise of the rights of use of others in the building
      in which the Apartment is located. The #TT #tt-verb obliged to keep the area
      in front of the Apartment clean and clear.
    ]
    #_item(8)[
      The #TT #tt-verb obliged to notify the #LL in writing and without undue
      delay of any decrease in, or change to, the persons living in the Apartment.
      If the #TT fail#{if nt > 1 [] else [s]} to do so within two months of the
      change occurring, #{if nt > 1 {"they"} else {"he or she"}} shall be deemed
      to have materially breached #{if nt > 1 {"their"} else {"his or her"}}
      obligation. The #LL #ll-verb entitled to require that only such number of
      persons live in the Apartment as is appropriate to its size, being a maximum
      of #p.maxOccupants persons. The #TT acknowledge#{if nt > 1 [] else [s]} that
      the number of persons registered with the building's owners' association
      (#emph[SVJ]) determines part of the Services cost, and that a change in that
      number will be reflected in the advance payments under Article 5.
    ]
    #_item(9)[
      The #TT may sublet the Apartment or a part of it to a third party only with
      the prior written consent of the #LL. If the #TT sublet#{if nt > 1 [] else [s]} the Apartment or
      a part of it to a third party in breach of this Agreement, this constitutes
      a gross breach of #{if nt > 1 {"their"} else {"his or her"}} obligations.
    ]
    #_item(10)[
      The #TT acknowledge#{if nt > 1 [] else [s]} that the #LL #ll-verb not liable
      for property and items brought into the Apartment by the #TT or by other
      persons.
    ]
    #_item(11)[
      The #LL #ll-has the Apartment insured; the #TT #tt-verb obliged to take out
      household contents insurance together with liability insurance covering
      damage arising from the running of the household.
    ]
    #_item(12)[
      If the #TT know#{if nt > 1 [] else [s]} in advance of an absence from the
      Apartment lasting longer than two months, and that the Apartment will be
      difficult to access during that time, the #TT shall notify the #LL in good
      time. At the same time the #TT shall designate a person who will, during
      that absence, ensure access to the Apartment where strictly necessary; if
      the #TT #tt-has no such person available, that person shall be the #LL. If
      the #TT fail#{if nt > 1 [] else [s]} to comply with this obligation, such
      conduct shall be regarded as a material breach of the #TTp obligations.#{
        if nt > 1 [
          #" " This paragraph applies only in the case of the absence of all
          occupants of the Apartment.
        ]
      }
    ]
    #_item(13)[
      During the period of one month before the termination of the lease, the #TT
      #tt-verb obliged to allow viewings of the Apartment in the presence of the
      #LL and the #TT or their representatives, subject to prior notice of at
      least 48 hours.
    ]
    #_item(14)[
      As of the date of termination of the lease, the #TT undertake#{if nt > 1 [] else [s]}
      to vacate the Apartment and hand it over to the #LL in the condition in
      which #{if nt > 1 {"they"} else {"he or she"}} received it, having regard to
      ordinary wear and tear, emptied, clean, functional and painted white. Minor
      repairs and the costs associated with the ordinary maintenance of the
      Apartment, the need for which arose before the end of the lease, shall be
      arranged by the #TT no later than the date of handover of the Apartment. The
      #TT acknowledge#{if nt > 1 [] else [s]} that a breach of this Article may
      give rise to substantial damage.
    ]
    #_item(15)[
      If the #TT #tt-does not hand over the Leased Premises to the #LL within
      #str(d.handback.graceDays) days of the end of the lease, and after the #LL
      #{if nl > 1 [have] else [has]} given the #TT written notice both by post and
      by email, the #LL #ll-verb entitled to obtain access to the Leased Premises
      and to clear them. The #LL shall draw up an inventory of the items removed,
      including photographic documentation, and shall store them at the #TTp cost.
      The #LL shall store the items for #str(d.handback.storageMonths) months from
      their removal; if the #TT #tt-does not collect them within that period, the
      #LL may, after a further written notice, dispose of them and set off the
      costs of removal and storage against the proceeds. The #LL #ll-verb
      entitled to compensation in
      the amount of the agreed rent and Services for the period from the day on
      which the #TT should have handed over the Apartment until the day on which
      the #TT actually #{if nt > 1 {"do"} else {"does"}} so.
    ]
    #_item(16)[
      If, after the Apartment has been handed back to the #LL, any items brought
      into the Apartment by the #TT remain there, such items shall be deemed
      abandoned by the #TT and the #LL may deal with them at their discretion.
    ]
    #_item(17)[
      The #LL #ll-verb obliged to ensure the proper provision of the Services
      associated with the use of the Apartment and to enable the #TT to exercise
      the rights associated with the lease undisturbed.
    ]
    #_item(18)[
      The #LL #ll-verb entitled to request access to the Apartment for the purpose
      of reading the electricity and water meters located in the Apartment, and
      also for the purpose of checking whether the #TT #tt-verb using it properly
      and for the purpose stated in this Agreement. The #LL shall notify the #TT
      of the date of the inspection sufficiently in advance. Prior notice is not
      required where it is necessary to prevent damage or where there is a risk in
      delay.
    ]
  ]

  // ── art. 7 ──
  _article("7", "Minor Repairs")[
    #_item(1)[
      Minor repairs mean repairs to the Leased Premises and their internal
      equipment, where such equipment forms part of the Leased Premises and is
      owned by the #LL, determined either by their nature or by the amount of the
      cost. This Article reflects Government Regulation No. 308/2015 Coll.
    ]
    #_item(2)[
      By their nature, the following repairs and replacements are considered minor
      repairs:
      #_let("a")[
        repairs to individual upper parts of floors, repairs to floor coverings
        and replacements of thresholds and skirting boards,
      ]
      #_let("b")[
        repairs to individual parts of windows and doors and their components, and
        replacements of locks, fittings, handles, blinds and shutters,
      ]
      #_let("c")[
        replacements of electrical terminal and distribution devices, in
        particular switches, sockets, circuit breakers, doorbells, door
        intercoms, data network sockets, analogue and digital television signal
        sockets, and replacements of light sources in light fittings,
      ]
      #_let("d")[
        replacements of shut-off valves on gas distribution lines, with the
        exception of the main shut-off valve for the Leased Premises,
      ]
      #_let("e")[
        repairs to shut-off fittings on water distribution lines, replacements of
        siphons and grease traps,
      ]
      #_let("f")[
        repairs to heating cost allocators and repairs and certification of hot
        and cold water meters.
      ]
    ]
    #_item(3)[
      Minor repairs further include repairs to water outlets, odour traps, extractor
      fans, cooker hoods, mixer taps, showers, water heaters, bidets, washbasins,
      baths, sinks, kitchen sinks, flushing systems, kitchen cookers, ovens, hobs,
      infrared heaters, kitchen units, and built-in and adjoining cabinets. In the
      case of heating equipment, minor repairs include repairs to solid-fuel, gas
      and electric stoves and to floor-level central heating boilers for solid,
      liquid and gaseous fuels, including shut-off and control fittings and control
      thermostats of such heating; they do not, however, include repairs to
      radiators and to central heating distribution lines.
    ]
    #_item(4)[
      Replacements of minor components of the items listed in paragraph 3 are also
      considered minor repairs.
    ]
    #_item(5)[
      By the amount of the cost, minor repairs also include other repairs to the
      Leased Premises and their equipment, and replacements of components of
      individual items of such equipment not listed in paragraphs 2 and 3, provided
      that the cost of a single repair does not exceed
      #amount(d.repairs.perRepairLimitHal)\u{00A0}CZK. Where several repairs are
      carried out on the same item which are related and follow on from one another
      in time, the aggregate cost of the related repairs is decisive. Transport
      costs and other costs associated with a repair, if stated in the tax document
      for the repair, are not included in the cost of that repair, but they do form
      part of the annual limit under paragraph 6.
    ]
    #_item(6)[
      The aggregate of the costs of the minor repairs referred to in paragraphs 2
      to 5 must not exceed #amount(d.repairs.annualLimitPerM2Hal)\u{00A0}CZK per
      m#super[2] of the floor area of the Leased Premises per calendar year,
      including transport costs and other costs associated with a repair if stated
      in the tax document for the repair.
    ]
    #_item(7)[
      For these purposes, the floor area of the Leased Premises means the aggregate
      of the floor areas of the Leased Premises and their appurtenances, including
      those outside the Leased Premises, provided that they are used exclusively by
      the #TT.
    ]
  ]

  // ── art. 8 ──
  _article("8", "Termination of the Lease")[
    #_item(1)[
      The lease of the Apartment shall terminate on expiry of the term of the
      lease, by written agreement between the #LL and the #TT, or by written
      notice pursuant to the relevant provisions of Act No. 89/2012 Coll., the
      Civil Code.
    ]
    #_item(2)[
      The #TT may terminate a fixed-term lease by notice only if the circumstances
      on which the parties relied when entering into this Agreement change to such
      an extent that the #TT cannot reasonably be required to continue the lease.
    ]
    #_item(3)[
      The #LL may terminate the lease by notice subject to a three-month notice
      period if
      #_let("a")[the #TT grossly breach#{if nt > 1 [] else [es]} an obligation
        arising from the lease,]
      #_let("b")[
        the #TT #tt-verb convicted of an intentional criminal offence committed
        against the #LL or a member of their household, or against a person living
        in the building in which the #TTp Apartment is located, or against
        third-party property located in that building,
      ]
      #_let("c")[
        the Apartment is to be vacated because it is necessary in the public
        interest to deal with the Apartment or the building in which it is located
        in such a way that the Apartment cannot be used at all, or
      ]
      #_let("d")[there is another similarly serious reason for terminating the lease.]
    ]
    #_item(4)[
      If the #TT breach#{if nt > 1 [] else [es]} an obligation in a particularly
      serious manner, the #LL #ll-has the right to terminate the lease without
      a notice period, in particular where the #TT #tt-has not paid the rent and
      the Services for a period of at least three months, #{if nt > 1 {"they damage"} else {"he or she damages"}}
      the Apartment or the building in a serious or irreparable manner,
      #{if nt > 1 {"they otherwise cause"} else {"he or she otherwise causes"}}
      serious damage or nuisance to the #LL or to persons living in the building,
      or #{if nt > 1 {"they use"} else {"he or she uses"}} the Apartment without
      authorisation in a manner or for a purpose other than that agreed.
    ]
  ]

  // ── art. 9 ──
  _article("9", "Final Provisions")[
    #{
      // Typst closures nemodifikují zachycené proměnné — čísla odstavců proto
      // posouváme offsetem `o` podle toho, jestli je tu odst. o solidaritě.
      let o = if nt > 1 { 1 } else { 0 }
      if nt > 1 {
        _item(1)[
          Wherever the rights and obligations of the #TT are referred to in the
          singular in this Agreement, those rights and obligations apply to each
          of the occupants of the Apartment, and each of them bears full
          responsibility for any failure to perform or breach of them. They are
          jointly and severally liable at all times for the proper, full and
          timely performance of the monetary obligations arising from this
          Agreement.
        ]
      }
      _item(o + 1)[
        This Agreement is executed in the English language and is governed by the
        laws of the Czech Republic, in particular by Act No. 89/2012 Coll., the
        Civil Code. The parties confirm that they understand the English language
        and that the content of this Agreement has been explained to them and is
        clear to them. Where a Czech term is given in brackets, it is given for
        the purposes of dealings with Czech authorities and prevails in the
        interpretation of the relevant legal concept. Should a translation of this
        Agreement into another language be made, the English version shall prevail
        in the event of any discrepancy. Any dispute arising from this Agreement
        shall be decided by the courts of the Czech Republic.
      ]
      _item(o + 2)[
        #{
          // e-mailové doručování je volitelné — bez `noticeEmail` se vypne
          let le = d.at("noticeEmail", default: none)
          let te = d.tenants.filter(t => t.at("email", default: none) != none)
          if le != none and te.len() > 0 [
            The contact details of the parties are the addresses stated above and
            the following email addresses: for the #LL, *#le*; for the #TT,
            #{
              if te.len() == 1 [*#te.at(0).email*]
              else [#te.map(t => t.name + " (" + t.email + ")").join(", ")]
            }. Notices and communications under this Agreement, in particular
            delivery of the annual settlement of the Services and notices under
            Article 5, may be delivered by email to the address stated above and
            are deemed delivered on the day following dispatch, unless the sender
            receives notice of non-delivery. *Notice of termination of the lease
            and amendments to this Agreement must be delivered in paper form by
            post*; a copy may be sent by email.
          ]
        }
        The parties have agreed that the effects of delivery to the address of the
        other party shall arise even if a registered letter is returned to the
        sender as undelivered, namely on the day on which the item was deposited
        with the holder of the postal licence or, if the item is not deposited with
        the holder of the postal licence, on the day on which the undelivered item
        was returned to the sender. Each party shall notify the other in writing
        without undue delay of any change to its address or email address.
      ]
      _item(o + 3)[
        Rights and obligations associated with the lease of the Apartment which are
        not regulated by this Agreement shall be governed by the relevant provisions
        of Act No. 89/2012 Coll., the Civil Code, and by Act No. 67/2013 Coll.,
        governing certain aspects of the provision of services associated with the
        use of apartments.
      ]
      _item(o + 4)[
        The parties acknowledge and agree that this Agreement contains their
        personal data, protected under Regulation (EU) 2016/679 (GDPR) and Act
        No. 110/2019 Coll., on the processing of personal data. The #LL
        process#{if nl > 1 [] else [es]} the #TTp personal data for the purpose of
        performing this Agreement, fulfilling legal obligations and settling the
        Services, and #{if nl > 1 {"they retain"} else {"retains"}} it for the
        period required by law. By signing this Agreement, the parties consent to
        the processing of their personal data for these purposes.
      ]
      _item(o + 5)[
        Any amendments or supplements to this Agreement may be made only in written
        form, by consecutively numbered amendments. This Agreement is executed in
        #d.copies counterparts, each party receiving one counterpart.
      ]
      _item(o + 6)[
        The parties to this Agreement expressly declare that this Agreement was
        drawn up on the basis of their free and true will, seriously and
        definitely, without duress and without conspicuously disadvantageous
        conditions, in witness whereof they append their handwritten signatures
        below.
      ]
    }
  ]

  v(0.8em)
  for (i, a) in d.attachments.enumerate() {
    [Annex No. #(i + 1): #a \ ]
  }

  v(0.8em)
  [In #d.signLocation, on #dayb(d.signDate)]

  // ── signatures ──
  block(breakable: false)[
    #v(2.2em)
    #grid(
      columns: (1fr, 1fr),
      column-gutter: 2em,
      row-gutter: 2.5em,
      ..d.landlords.map(n => align(center)[
        #line(length: 80%, stroke: 0.6pt) \
        #n.name \
        #emph[#lower(LLrole)]
      ]),
      ..(if calc.rem(nl, 2) == 1 { ([],) } else { () }),
      ..d.tenants.map(n => align(center)[
        #line(length: 80%, stroke: 0.6pt) \
        #n.name \
        #emph[#lower(TTrole)]
      ])
    )
  ]
}


#lease-agreement(vars)
