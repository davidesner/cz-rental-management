// Smlouva o nájmu bytu — generic CZ template (reference / starting point).
// Skill by typicky vyrobil tu vlastní z user-ova zdrojového dokumentu (viz Workflow A v SKILL.md).
// Tahle slouží jako sanity-check struktury, ne jako produkční šablona.

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

// ─── Header ────────────────────────────────────────────
Níže uvedeného dne, měsíce a roku uzavřely smluvní strany

#v(0.6em)

*{{landlord.name}}*, \
nar. {{landlord.dob}}, \
trvale bytem {{landlord.address}}

(dále jen "*pronajímatel*") na straně jedné

#v(0.3em)
a
#v(0.3em)

*{{tenant.name}}*, \
nar. {{tenant.dob}}, \
trvale bytem {{tenant.address}}

(dále jen "*nájemce*") na straně druhé

#v(0.4em)

tuto

#v(0.4em)

#align(center)[
  #text(size: 14pt, weight: "bold")[Smlouvu o nájmu bytu:]
  #linebreak()
  #emph[(podle § 2235 a násl. zákon číslo 89/2012, Občanský zákoník)]
]

// ─── Č1 ────────────────────────────────────────────────
#article("1", "Předmět nájmu")[
  #item(1)[
    Pronajímatel je výlučným vlastníkem jednotky č. *{{property.unitNumber}}*,
    nacházející se v {{property.floor}}. nadzemním podlaží bytového domu
    {{property.buildingDescription}}, v obci {{property.municipality}},
    katastrální území {{property.cadastre}}, zapsaném na LV č. {{property.lvNumber}},
    vedeném Katastrálním úřadem pro hlavní město Prahu.
    Touto smlouvou pronajímatel přenechává nájemci do nájmu byt *{{property.layout}}*
    {{property.accessories}}.
  ]
  #item(2)[
    Nájemce je oprávněn užívat byt pouze za účelem bydlení, užívání bytu
    jinými osobami se nepřipouští.
  ]
  #item(3)[
    Nájemce je povinen užívat předmět nájmu s péčí řádného hospodáře.
  ]
]

// ─── Č3 ────────────────────────────────────────────────
#article("3", "Doba nájmu")[
  Nájem se sjednává {{lease.fixedTermDescription}} s účinností
  *od {{lease.startDate}} do {{lease.endDate}}*. Doba nájmu se může automaticky
  prodloužit vždy o další 1 rok, pokud ani jedna ze smluvních stran písemně
  neoznámí druhé smluvní straně, že nemá zájem na dalším prodloužení.
]

// ─── Č4 ────────────────────────────────────────────────
#article("4", "Předání a převzetí bytu")[
  #item(1)[
    Smluvní strany svými podpisy pod touto smlouvou stvrzují, že byt je ve stavu
    způsobilém ke sjednanému účelu užívání.
  ]
  #item(2)[
    Nájemce se zavazuje uhradit na účet pronajímatele č. účtu {{landlord.bankAccount}}
    do {{deposit.dueDate}} částku ve výši *{{deposit.amount}} Kč* jako jistotu
    k zajištění nájemného a k úhradě jiných svých závazků vzniklých v souvislosti s nájmem.
  ]
]

// ─── Č5 ────────────────────────────────────────────────
#article("5", "Nájemné a úhrada za plnění poskytovaná s užíváním bytu")[
  #item(1)[
    Nájemce je povinen za užívání bytu platit pronajímateli nájemné, které bylo
    dohodnuto ve výši *{{terms.baseRent}} Kč* měsíčně. Toto nájemné je splatné
    do *{{terms.paymentDueDay}}. dne* příslušného měsíce, za který je placeno,
    a to na účet pronajímatele č. účtu {{landlord.bankAccount}}.
  ]
  #item(2)[
    Smluvní strany se dohodly na výši úhrady záloh za plnění poskytovaná s
    užíváním bytu (dále jen "služby"), a to ve výši *{{terms.serviceAdvance}} Kč*
    měsíčně, splatné spolu s nájemným.
  ]
  #item(3)[
    Pronajímatel je oprávněn každoročně zvýšit nájemné v souladu s mírou inflace
    vyhlášené Českým statistickým úřadem.
  ]
]

// ─── Závěr ─────────────────────────────────────────────
#v(2em)

V {{signLocation}} dne {{signDate}}

#v(2.5em)

#grid(
  columns: (1fr, 1fr),
  align(center)[
    ………………………………………… \
    *{{landlord.name}}* \
    pronajímatel
  ],
  align(center)[
    ………………………………………… \
    *{{tenant.name}}* \
    nájemce
  ],
)
