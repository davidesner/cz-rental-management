// ════════════════════════════════════════════════════════════════════════════
// handover-en — Handover Protocol (příloha nájemní smlouvy), ENGLISH
//
// Vytvořeno 6. 9. 2026 pro <nemovitost>/najem/<rok>-<najemce>/. Strukturu
// opisuje z `<nemovitost>/najem/<rok>-<najemce>/<protokol>.jpeg`
// (jediný protokol, který v archivu existoval), rozšířenou o:
//   - sloupec „Condition at handover" u každé položky (originál ho neměl,
//     takže se stav nedal doložit)
//   - VT i NT registr zvlášť u elektroměru — na dvoutarifní sazbě má
//     elektroměr dva registry a jedno číslo nestačí
//   - kontaktní osobu podle čl. 6 odst. 12 smlouvy (ve smlouvě jmenovaná není
//     schválně, aby se dala měnit bez dodatku)
//   - sekci na závady a na protistranu při vrácení bytu
//
// Sází se stejným stylem jako `lease-en.typ`, ať to k sobě patří.
//
// {{equipment}}, {{keys}}, {{meters}}, {{landlords}}, {{contactPerson}} a
// {{notes}} se nahrazují CELÝM Typst literálem. Prázdné řádky k vyplnění na
// místě vznikají tak, že se `condition` nechá "" — vysází se linka.
// ════════════════════════════════════════════════════════════════════════════

#let vars = (
  annexNumber: "{{annexNumber}}",
  leaseDate: "{{leaseDate}}",

  landlords: {{landlords}},
  tenants: {{tenants}},

  property: (
    unitNumber: "{{property.unitNumber}}",
    layout: "{{property.layout}}",
    floor: "{{property.floor}}",
    address: "{{property.address}}",
  ),

  // ((room: "Kitchen", items: ("...", "...")), ..)
  equipment: {{equipment}},

  // (("2x flat key", ""), ("1x mailbox key", ""))  — druhá položka = počet
  keys: {{keys}},

  // ((label: "Electricity meter no. .... — high tariff (VT)", unit: "kWh"), ..)
  meters: {{meters}},

  contactPerson: {{contactPerson}},   // (name: .., phone: .., note: ..) nebo none
  notes: {{notes}},                   // počet prázdných řádků na závady
  signLocation: "{{signLocation}}",
  signDate: "{{signDate}}",
)


// ─── helpers ────────────────────────────────────────────────────────────────

#let _months = ("January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December")

#let day(s) = {
  if s == none or s == "" { return "" }
  let p = s.split("-")
  str(int(p.at(2))) + "\u{00A0}" + _months.at(int(p.at(1)) - 1) + "\u{00A0}" + p.at(0)
}

#let _fill(w) = box(width: w, repeat[.])

#let _section(title, body) = {
  v(0.9em)
  block(below: 0.5em)[#text(weight: "bold", size: 11pt)[#title]]
  line(length: 100%, stroke: 0.5pt + luma(160))
  v(0.4em)
  body
}


// ─── document ───────────────────────────────────────────────────────────────

#let handover(d) = {
  set page(paper: "a4", margin: (top: 2.2cm, bottom: 2cm, left: 2.4cm, right: 2.4cm),
           numbering: "1")
  set text(font: "New Computer Modern", size: 10.5pt, lang: "en")
  set par(justify: true, leading: 0.6em, spacing: 0.9em, first-line-indent: 0pt)

  let p = d.property
  let nl = d.landlords.len()
  let nt = d.tenants.len()
  let LL = if nl > 1 { "Landlords" } else { "Landlord" }
  let TT = if nt > 1 { "Tenants" } else { "Tenant" }
  let tt-verb = if nt > 1 { "have" } else { "has" }

  align(center)[
    #text(size: 9pt)[Annex No. #d.annexNumber to the Residential Lease Agreement
      of #day(d.leaseDate)]
    #v(0.5em)
    #text(size: 15pt, weight: "bold")[HANDOVER PROTOCOL]
  ]
  v(0.8em)

  [
    In connection with the Residential Lease Agreement of #day(d.leaseDate)
    concerning unit No. #p.unitNumber, #p.layout, located on #p.floor of the
    building at #p.address, the above unit was handed over on the date stated
    below. By signing this protocol the #TT confirm#{if nt > 1 [] else [s]} that
    #{if nt > 1 {"they have"} else {"he or she has"}} inspected the Leased
    Premises and #{if nt > 1 {"accept"} else {"accepts"}} #{if nt > 1 {"them"} else {"it"}}
    in a condition fit for the agreed purpose of use, together with the equipment
    listed below.
  ]

  // ── equipment ──
  for grp in d.equipment {
    _section(grp.room)[
      #table(
        columns: (1fr, 6.2em),
        stroke: none,
        inset: (x: 0pt, y: 3.2pt),
        align: (left, center + top),
        table.header(
          text(size: 8.5pt, style: "italic")[Item],
          text(size: 8.5pt, style: "italic")[Condition],
        ),
        ..grp.items.map(it => (it, _fill(100%))).flatten()
      )
    ]
  }

  // ── keys ──
  _section("Keys handed over")[
    #table(
      columns: (1fr, 6.2em),
      stroke: none,
      inset: (x: 0pt, y: 3.2pt),
      align: (left, center + top),
      ..d.keys.map(k => (k, _fill(100%))).flatten()
    )
  ]

  // ── meters ──
  _section("Meter readings at handover")[
    #table(
      columns: (1fr, 8em, 4em),
      stroke: none,
      inset: (x: 0pt, y: 4pt),
      column-gutter: 0.8em,
      align: (left, center + top, left + top),
      table.header(
        text(size: 8.5pt, style: "italic")[Meter],
        text(size: 8.5pt, style: "italic")[Reading],
        text(size: 8.5pt, style: "italic")[Unit],
      ),
      ..d.meters.map(m => (m.label, _fill(100%), m.unit)).flatten()
    )
    #v(0.3em)
    #text(size: 9pt, style: "italic")[
      The electricity meter has two registers. Both the high-tariff (VT) and the
      low-tariff (NT) reading must be recorded; the annual settlement of
      electricity is based on them.
    ]
  ]

  // ── contact person ── (tělo funkce je code mode, `#` sem nepatří)
  {
    let c = d.at("contactPerson", default: none)
    if c != none {
      _section("Contact person for access during the Tenant's absence")[
        Pursuant to Article 6(12) of the Lease Agreement, the #TT
        #{if nt > 1 {"designate"} else {"designates"}} the following person to
        ensure access to the Apartment where strictly necessary during an absence
        longer than two months: \
        #v(0.3em)
        Name: *#c.name* #h(2em) Phone: #{if c.phone == "" [#_fill(9em)] else [*#c.phone*]} \
        #v(0.2em)
        Holds a key to the Apartment: #_fill(4em) \
        #v(0.2em)
        #text(size: 9pt, style: "italic")[
          A change of this person shall be notified to the #LL in writing. This
          designation does not relieve the #TT of the duty to notify the #LL of
          each absence under Article 6(12).
        ]
      ]
    }
  }

  // ── defects ──
  _section("Defects and remarks recorded at handover")[
    #for _ in range(d.notes) [
      #_fill(100%) \
      #v(0.35em)
    ]
    #text(size: 9pt, style: "italic")[
      If no defect is recorded, the Leased Premises are handed over without
      apparent defects.
    ]
  ]

  _section("Photographic documentation")[
    Photographs of the Leased Premises and of the equipment taken on the date of
    handover form part of this protocol. Number of photographs: #_fill(5em)
  ]

  v(0.8em)
  [In #d.signLocation, on #day(d.signDate)]

  block(breakable: false)[
    #v(2.2em)
    #grid(
      columns: (1fr, 1fr),
      column-gutter: 2em,
      row-gutter: 2.5em,
      ..d.landlords.map(n => align(center)[
        #line(length: 80%, stroke: 0.6pt) \
        #n \
        #emph[landlord]
      ]),
      ..(if calc.rem(nl, 2) == 1 { ([],) } else { () }),
      ..d.tenants.map(n => align(center)[
        #line(length: 80%, stroke: 0.6pt) \
        #n \
        #emph[tenant]
      ])
    )
  ]
}

#handover(vars)
