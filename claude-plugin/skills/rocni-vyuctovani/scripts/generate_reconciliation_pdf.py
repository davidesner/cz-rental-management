#!/usr/bin/env python3
"""Generate roční vyúčtování PDF for tenant.

Reusable template. To use:
1. Copy this file to `properties/<slug>/generate_pdf_<year>.py`
2. Fill in the RECONCILIATION dict below with property/year specific data
3. Run: python3 generate_pdf_<year>.py

Layout: 5 pages
- Page 1: Header, identification, big result box, summary table, notes
- Pages 2..N-1: Per-kind sheets (services, electricity, ...) with intro,
                tables, and calculation block
- Page N: Payment instruction box with details + reklamace + podklady list

All amounts are Decimal; format with fmt_kc().

Czech char rendering requires a Unicode TTF font (macOS Arial used by default).
On other systems, override BASE_FONT_PATH / BASE_FONT_BOLD_PATH.
"""
from decimal import Decimal
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont


# =============================================================================
# CONFIG — fill this in per property/year
# =============================================================================

RECONCILIATION = {
    "output_path": "Vyuctovani_<Property>_<Year>.pdf",
    "title": "ROČNÍ VYÚČTOVÁNÍ PRONÁJMU",
    "period_human": "1. ledna 2025 – 31. prosince 2025",
    "footer_text": "Roční vyúčtování 2025 — <Property>, <Address>",
    "issued_at_human": "<dd. mm. yyyy>",

    "identification": [
        # (label, value) pairs for page 1 header block
        ("Nemovitost:", "<address + unit numbers>"),
        ("Pronajímatel:", "<name, address>"),
        ("Nájemce:", "<name(s) + responsibility note>"),
        ("Smlouva:", "<period + renewal note>"),
        ("VS SVJ:", "<variable symbol>"),
        ("Vystaveno:", "<date>"),
    ],

    # Big result box on page 1 and last page
    "result": {
        "label_p1": "PŘEPLATEK NÁJEMCE",           # or "NEDOPLATEK NÁJEMCE"
        "amount_kc": Decimal("0.00"),
        "subtitle_p1": "k vrácení nájemci na účet <acct>",
        "label_pN": "K vrácení nájemci",            # or "K doplacení"
    },

    # Summary table on page 1
    "summary": {
        # (label, cost, paid, diff) — diff positive = tenant overpaid = refund
        "items": [
            ("Nájem", Decimal("0"), Decimal("0"), Decimal("0")),
            ("Služby (SVJ)", Decimal("0"), Decimal("0"), Decimal("0")),
            ("Elektřina", Decimal("0"), Decimal("0"), Decimal("0")),
        ],
        # Optional: rows here automatically summed to CELKEM row
        "notes_html": [
            # Each entry rendered as a • bullet, HTML <b> tags allowed
            "<b>Nájem:</b> ...",
            "<b>Služby:</b> ...",
            "<b>Elektřina:</b> ...",
            "<b>Platby:</b> ...",
        ],
    },

    # Sheets (one per kind, page each)
    "sheets": [
        # Each sheet is a dict; supported "type"s:
        #   "services"   — SVJ-style with breakdown by unit, FO odečet, calc
        #   "electricity_monthly" — 12 monthly invoices table + calc
        #   "payments"   — list of monthly payments + alokace + notes
        # Or use "type":"custom" and pass "blocks": [Paragraph|Table|...]
        {
            "type": "services",
            "title": "LIST 1 – SLUŽBY (SVJ <provider>)",
            "intro": "Podklad: <provider>, Detail vyúčtování ...",
            "units_table": {
                "header": ["Jednotka", "Náklady SVJ", "Předepsané zálohy", "Přeplatek SVJ"],
                "rows": [
                    # (unit, cost, advance, diff)
                    ("Byt KP1-253", Decimal("0"), Decimal("0"), Decimal("0")),
                ],
                "totals_label": "SOUČET (vlastník)",
            },
            "fo_intro": "Část záloh SVJ tvoří investiční výdaje pronajímatele ...",
            "fo_components": [
                # (label, monthly_kc)
                ("Fond oprav", Decimal("0")),
                ("Správa SVJ", Decimal("0")),
                ("Odměny statutár", Decimal("0")),
                ("Pojištění domu", Decimal("0")),
                ("Ostatní režie", Decimal("0")),
            ],
            "fo_total_monthly": Decimal("0"),
            "fo_total_yearly": Decimal("0"),
            "calc": {
                # Final calculation block
                "lines": [
                    # (label, amount) — last line is highlighted as result
                    ("Hrubé náklady SVJ (vč. FO)", Decimal("0")),
                    ("minus: Odečet FO + režie (pronajímatel)", Decimal("0")),
                    ("Skutečný náklad nájemce", Decimal("0")),
                    ("minus: Zaplacené zálohy", Decimal("0")),
                ],
                "result_label": "PŘEPLATEK SLUŽBY",
                "result_amount": Decimal("0"),
            },
        },
        {
            "type": "electricity_monthly",
            "title": "LIST 2 – ELEKTŘINA (PRE + solar)",
            "intro_paragraphs": [
                "Dodavatel: PRE, sazba ...",
                "<b>Solar (FVE):</b> ...",
            ],
            "table_header": ["Měsíc", "Faktura PRE", "kWh\nfakturováno",
                            "kWh\nsolar", "PRE (Kč)", "Solar (Kč)", "Celkem (Kč)"],
            "rows": [
                # (month, invoice, kwh_net, solar_kwh, pre_kc, solar_kc, total_kc)
                ("01/2025", "...", 0, 0, Decimal("0"), Decimal("0"), Decimal("0")),
            ],
            "totals_label": "CELKEM",
            "calc": {
                "lines": [
                    ("Faktury PRE (12 měsíců)", Decimal("0")),
                    ("+ Úhrada pronajímateli za solar", Decimal("0")),
                    ("Skutečný náklad nájemce", Decimal("0")),
                    ("minus: Zaplacené zálohy", Decimal("0")),
                ],
                "result_label": "PŘEPLATEK ELEKTŘINA",
                "result_amount": Decimal("0"),
            },
        },
        {
            "type": "payments",
            "title": "LIST 3 – PLATBY NÁJEMCE",
            "intro": "Přijaté platby na účet ...",
            "table_header": ["Měsíc", "Datum platby", "Částka (Kč)",
                            "Očekáváno", "Rozdíl", "Poznámka"],
            "rows": [
                # (month, date_human, amount, expected, diff, note)
                ("01/2025", "...", Decimal("0"), Decimal("0"), Decimal("0"), ""),
            ],
            "totals_label": "CELKEM",
            "extra_sections": [
                # (heading, body) pairs
                ("Alokace plateb", "Z přijatých ... Kč je ..."),
                ("Lednová srážka", "Nájemce v lednu ..."),
            ],
        },
    ],

    "payment_instruction": {
        "title": "VRÁCENÍ PŘEPLATKU",  # or "DOPLACENÍ NEDOPLATKU"
        "details": [
            # (label, value)
            ("Příjemce:", "..."),
            ("Účet:", "..."),
            ("Částka:", "..."),
            ("Variabilní symbol:", "..."),
            ("Splatnost:", "do 30 dnů od doručení vyúčtování"),
        ],
        "reklamace_text": "Případné nesrovnalosti ...",
        "documents": [
            # Bullet list of supporting documents
            "...",
        ],
    },
}

# =============================================================================
# Layout (generic; usually no need to edit below)
# =============================================================================

# Font registration — adjust paths if not on macOS
BASE_FONT_PATH = "/System/Library/Fonts/Supplemental/Arial.ttf"
BASE_FONT_BOLD_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
BASE_FONT = "Arial"
BASE_FONT_BOLD = "Arial-Bold"

if Path(BASE_FONT_PATH).exists():
    pdfmetrics.registerFont(TTFont(BASE_FONT, BASE_FONT_PATH))
    pdfmetrics.registerFont(TTFont(BASE_FONT_BOLD, BASE_FONT_BOLD_PATH))
else:
    BASE_FONT = "Helvetica"
    BASE_FONT_BOLD = "Helvetica-Bold"

# Color palette
NAVY = colors.HexColor("#1a3a5c")
TEAL = colors.HexColor("#2d6a8f")
LIGHT_BLUE = colors.HexColor("#e8f1f8")
DARK_GREEN = colors.HexColor("#2d6e3e")
DARK_RED = colors.HexColor("#9c2a2a")
LIGHT_GREEN = colors.HexColor("#e8f5ec")
LIGHT_RED = colors.HexColor("#fbe8e8")
GRAY = colors.HexColor("#555555")
BORDER = colors.HexColor("#cccccc")

# Styles
_styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=_styles["Heading1"], fontName=BASE_FONT_BOLD,
                   fontSize=20, textColor=NAVY, spaceAfter=8, alignment=TA_LEFT)
H2 = ParagraphStyle("H2", parent=_styles["Heading2"], fontName=BASE_FONT_BOLD,
                   fontSize=14, textColor=NAVY, spaceBefore=12, spaceAfter=8)
H3 = ParagraphStyle("H3", parent=_styles["Heading3"], fontName=BASE_FONT_BOLD,
                   fontSize=11, textColor=TEAL, spaceBefore=8, spaceAfter=4)
BODY = ParagraphStyle("Body", parent=_styles["BodyText"], fontName=BASE_FONT,
                     fontSize=10, leading=14, textColor=colors.black)
BIG_NUM = ParagraphStyle("BigNum", parent=_styles["BodyText"], fontName=BASE_FONT_BOLD,
                        fontSize=28, leading=34, textColor=DARK_GREEN,
                        alignment=TA_CENTER, spaceBefore=4, spaceAfter=4)
LABEL = ParagraphStyle("Label", parent=_styles["BodyText"], fontName=BASE_FONT,
                      fontSize=9, textColor=GRAY, alignment=TA_CENTER)


def fmt_kc(amount, decimals=2):
    """Format Decimal as Czech currency: 1 234,56 Kč. Negative gets − (minus sign)."""
    if not isinstance(amount, Decimal):
        amount = Decimal(str(amount))
    sign = "−" if amount < 0 else ""
    a = abs(amount)
    s = f"{a:,.{decimals}f}".replace(",", " ").replace(".", ",")
    return f"{sign}{s} Kč"


def fmt_diff(amount):
    """Like fmt_kc, but adds + for positive."""
    if not isinstance(amount, Decimal):
        amount = Decimal(str(amount))
    if amount > 0:
        return f"+{fmt_kc(amount)}"
    return fmt_kc(amount)


def is_refund(result):
    """Whether result indicates refund to tenant (use green) or extra payment owed (red)."""
    label = result.get("label_p1", "")
    return "PŘEPLATEK" in label.upper() or "VRÁCENÍ" in label.upper()


def result_colors(reconciliation):
    if is_refund(reconciliation["result"]):
        return DARK_GREEN, LIGHT_GREEN
    return DARK_RED, LIGHT_RED


# ---------- Page 1 ----------

def render_page1(story, R):
    story.append(Paragraph(R["title"], H1))
    story.append(Paragraph(f"Období: {R['period_human']}", H3))
    story.append(Spacer(1, 6))

    # Identification
    t = Table(R["identification"], colWidths=[35*mm, 130*mm])
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), BASE_FONT_BOLD),
        ("FONTNAME", (1, 0), (1, -1), BASE_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), GRAY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t)
    story.append(Spacer(1, 18))

    # Big result box
    story.append(Paragraph("VÝSLEDEK VYÚČTOVÁNÍ", H2))
    dark, light = result_colors(R)
    big_style = ParagraphStyle("BigStyle", parent=BIG_NUM, textColor=dark)
    box = Table(
        [[Paragraph(R["result"]["label_p1"], LABEL)],
         [Paragraph(fmt_kc(R["result"]["amount_kc"]), big_style)],
         [Paragraph(R["result"]["subtitle_p1"], LABEL)]],
        colWidths=[170*mm]
    )
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), light),
        ("BOX", (0, 0), (-1, -1), 1.5, dark),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(box)
    story.append(Spacer(1, 18))

    # Summary
    story.append(Paragraph("Souhrn po kategoriích", H2))
    summary = R["summary"]
    items = summary["items"]
    total_cost = sum((i[1] for i in items), Decimal("0"))
    total_paid = sum((i[2] for i in items), Decimal("0"))
    total_diff = sum((i[3] for i in items), Decimal("0"))
    data = [["Položka", "Skutečný náklad", "Zaplaceno zálohou", "Rozdíl"]]
    for label, cost, paid, diff in items:
        data.append([label, fmt_kc(cost), fmt_kc(paid), fmt_diff(diff)])
    data.append(["CELKEM", fmt_kc(total_cost), fmt_kc(total_paid), fmt_diff(total_diff)])
    t = Table(data, colWidths=[55*mm, 38*mm, 38*mm, 38*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), BASE_FONT_BOLD),
        ("FONTNAME", (0, 0), (-1, -1), BASE_FONT),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("FONTNAME", (0, -1), (-1, -1), BASE_FONT_BOLD),
        ("BACKGROUND", (0, -1), (-1, -1), LIGHT_BLUE),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("TEXTCOLOR", (3, 1), (3, -1), dark),
        ("FONTNAME", (3, 1), (3, -1), BASE_FONT_BOLD),
    ]))
    story.append(t)
    story.append(Spacer(1, 14))

    # Notes
    if summary.get("notes_html"):
        story.append(Paragraph("Poznámky", H3))
        for n in summary["notes_html"]:
            story.append(Paragraph("• " + n, BODY))
            story.append(Spacer(1, 4))

    story.append(PageBreak())


# ---------- Per-kind sheets ----------

def render_services_sheet(story, sheet):
    story.append(Paragraph(sheet["title"], H1))
    if sheet.get("intro"):
        story.append(Paragraph(sheet["intro"], BODY))
    story.append(Spacer(1, 10))

    # Units table
    ut = sheet["units_table"]
    rows = [ut["header"]]
    sum_cost = sum_adv = sum_diff = Decimal("0")
    for label, cost, adv, diff in ut["rows"]:
        rows.append([label, fmt_kc(cost), fmt_kc(adv), fmt_kc(diff)])
        sum_cost += cost
        sum_adv += adv
        sum_diff += diff
    rows.append([ut["totals_label"], fmt_kc(sum_cost), fmt_kc(sum_adv), fmt_kc(sum_diff)])
    story.append(Paragraph("Skutečné náklady dle SVJ", H3))
    t = Table(rows, colWidths=[50*mm, 40*mm, 40*mm, 40*mm])
    t.setStyle(_units_style())
    story.append(t)
    story.append(Spacer(1, 12))

    # FO components
    story.append(Paragraph("Odečet (Fond oprav a režie SVJ – nese pronajímatel)", H3))
    if sheet.get("fo_intro"):
        story.append(Paragraph(sheet["fo_intro"], BODY))
        story.append(Spacer(1, 4))
    fo_rows = [["Složka SVJ", "Měsíčně (Kč)"]]
    for label, amt in sheet["fo_components"]:
        fo_rows.append([label, f"{amt:,.0f}".replace(",", " ")])
    fo_rows.append(["Měsíční odečet", f"{sheet['fo_total_monthly']:,.0f}".replace(",", " ")])
    fo_rows.append(["× 12 měsíců = ROČNÍ ODEČET", fmt_kc(sheet["fo_total_yearly"], decimals=0)])
    t = Table(fo_rows, colWidths=[90*mm, 50*mm])
    t.setStyle(_fo_style())
    story.append(t)
    story.append(Spacer(1, 14))

    # Final calc
    story.append(Paragraph("Vyúčtování služeb (pohled nájemce)", H3))
    render_calc_block(story, sheet["calc"])
    story.append(PageBreak())


def render_electricity_monthly_sheet(story, sheet):
    story.append(Paragraph(sheet["title"], H1))
    for p in sheet.get("intro_paragraphs", []):
        story.append(Paragraph(p, BODY))
        story.append(Spacer(1, 6))
    story.append(Spacer(1, 4))

    rows = [sheet["table_header"]]
    sum_kwh = sum_solar = 0
    sum_pre = sum_sol_kc = sum_total = Decimal("0")
    for month, inv, kwh, solar, pre_kc, sol_kc, total_kc in sheet["rows"]:
        rows.append([month, inv, str(kwh), str(solar),
                    f"{pre_kc:,.2f}".replace(",", " ").replace(".", ","),
                    f"{sol_kc:,.2f}".replace(",", " ").replace(".", ","),
                    f"{total_kc:,.2f}".replace(",", " ").replace(".", ",")])
        sum_kwh += kwh
        sum_solar += solar
        sum_pre += pre_kc
        sum_sol_kc += sol_kc
        sum_total += total_kc
    rows.append([sheet["totals_label"], "", str(sum_kwh), str(sum_solar),
                f"{sum_pre:,.2f}".replace(",", " ").replace(".", ","),
                f"{sum_sol_kc:,.2f}".replace(",", " ").replace(".", ","),
                f"{sum_total:,.2f}".replace(",", " ").replace(".", ",")])
    t = Table(rows, colWidths=[20*mm, 28*mm, 22*mm, 18*mm, 26*mm, 24*mm, 30*mm])
    t.setStyle(_monthly_table_style())
    story.append(t)
    story.append(Spacer(1, 12))

    story.append(Paragraph("Vyúčtování elektřiny", H3))
    render_calc_block(story, sheet["calc"])
    story.append(PageBreak())


def render_payments_sheet(story, sheet):
    story.append(Paragraph(sheet["title"], H1))
    if sheet.get("intro"):
        story.append(Paragraph(sheet["intro"], BODY))
    story.append(Spacer(1, 10))

    rows = [sheet["table_header"]]
    sum_amount = sum_expected = sum_diff = Decimal("0")
    for month, date_h, amt, exp, diff, note in sheet["rows"]:
        rows.append([month, date_h,
                    f"{amt:,.2f}".replace(",", " ").replace(".", ","),
                    f"{exp:,.2f}".replace(",", " ").replace(".", ","),
                    f"{diff:,.2f}".replace(",", " ").replace(".", ","),
                    note])
        sum_amount += amt
        sum_expected += exp
        sum_diff += diff
    rows.append([sheet["totals_label"], "",
                f"{sum_amount:,.2f}".replace(",", " ").replace(".", ","),
                f"{sum_expected:,.2f}".replace(",", " ").replace(".", ","),
                f"{sum_diff:,.2f}".replace(",", " ").replace(".", ","), ""])
    t = Table(rows, colWidths=[20*mm, 27*mm, 27*mm, 27*mm, 22*mm, 42*mm])
    t.setStyle(_payments_table_style())
    story.append(t)
    story.append(Spacer(1, 18))

    for heading, body in sheet.get("extra_sections", []):
        story.append(Paragraph(heading, H3))
        story.append(Paragraph(body, BODY))
        story.append(Spacer(1, 8))


# ---------- Last page ----------

def render_payment_instruction(story, R):
    story.append(PageBreak())
    pi = R["payment_instruction"]
    story.append(Paragraph(pi["title"], H1))
    story.append(Spacer(1, 12))

    dark, light = result_colors(R)
    big_style = ParagraphStyle("BigStyle2", parent=BIG_NUM, textColor=dark)
    box = Table(
        [[Paragraph(R["result"]["label_pN"], LABEL)],
         [Paragraph(fmt_kc(R["result"]["amount_kc"]), big_style)]],
        colWidths=[170*mm]
    )
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), light),
        ("BOX", (0, 0), (-1, -1), 1.5, dark),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 18),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
    ]))
    story.append(box)
    story.append(Spacer(1, 18))

    t = Table(pi["details"], colWidths=[40*mm, 130*mm])
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), BASE_FONT_BOLD),
        ("FONTNAME", (1, 0), (1, -1), BASE_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 11),
        ("TEXTCOLOR", (0, 0), (0, -1), GRAY),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t)
    story.append(Spacer(1, 28))

    if pi.get("reklamace_text"):
        story.append(Paragraph("Reklamační lhůta", H3))
        story.append(Paragraph(pi["reklamace_text"], BODY))
        story.append(Spacer(1, 14))

    if pi.get("documents"):
        story.append(Paragraph("Podklady (k nahlédnutí na vyžádání)", H3))
        for d in pi["documents"]:
            story.append(Paragraph("• " + d, BODY))


# ---------- Helpers ----------

def render_calc_block(story, calc):
    rows = [[label, fmt_diff(amt) if amt < 0 else fmt_kc(amt)] for label, amt in calc["lines"]]
    rows.append([calc["result_label"], fmt_diff(calc["result_amount"])])
    width_label, width_amt = 110*mm, 50*mm
    t = Table(rows, colWidths=[width_label, width_amt])
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), BASE_FONT),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, -3), (-1, -3), 0.5, BORDER),
        ("LINEABOVE", (0, -1), (-1, -1), 1.5, DARK_GREEN),
        ("FONTNAME", (0, -1), (-1, -1), BASE_FONT_BOLD),
        ("BACKGROUND", (0, -1), (-1, -1), LIGHT_GREEN),
        ("TEXTCOLOR", (1, -1), (1, -1), DARK_GREEN),
    ]))
    story.append(t)


def _units_style():
    return TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), BASE_FONT),
        ("FONTNAME", (0, 0), (-1, 0), BASE_FONT_BOLD),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("FONTNAME", (0, -1), (-1, -1), BASE_FONT_BOLD),
        ("BACKGROUND", (0, -1), (-1, -1), LIGHT_BLUE),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
    ])


def _fo_style():
    return TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), BASE_FONT),
        ("FONTNAME", (0, 0), (-1, 0), BASE_FONT_BOLD),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("FONTNAME", (0, -2), (-1, -1), BASE_FONT_BOLD),
        ("BACKGROUND", (0, -1), (-1, -1), LIGHT_BLUE),
        ("LINEABOVE", (0, -2), (-1, -2), 1, NAVY),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
    ])


def _monthly_table_style():
    return TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), BASE_FONT),
        ("FONTNAME", (0, 0), (-1, 0), BASE_FONT_BOLD),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 1), (1, -1), "CENTER"),
        ("FONTNAME", (0, -1), (-1, -1), BASE_FONT_BOLD),
        ("BACKGROUND", (0, -1), (-1, -1), LIGHT_BLUE),
        ("LINEABOVE", (0, -1), (-1, -1), 1, NAVY),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.3, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#fafafa")]),
    ])


def _payments_table_style():
    return TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), BASE_FONT),
        ("FONTNAME", (0, 0), (-1, 0), BASE_FONT_BOLD),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("ALIGN", (2, 1), (4, -1), "RIGHT"),
        ("ALIGN", (0, 1), (1, -1), "CENTER"),
        ("FONTNAME", (0, -1), (-1, -1), BASE_FONT_BOLD),
        ("BACKGROUND", (0, -1), (-1, -1), LIGHT_BLUE),
        ("LINEABOVE", (0, -1), (-1, -1), 1, NAVY),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.3, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#fafafa")]),
    ])


# ---------- Build ----------

def build_pdf(R):
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont(BASE_FONT, 8)
        canvas.setFillColor(GRAY)
        canvas.drawString(20*mm, 12*mm, R["footer_text"])
        canvas.drawRightString(190*mm, 12*mm, f"Strana {doc.page}")
        canvas.line(20*mm, 15*mm, 190*mm, 15*mm)
        canvas.restoreState()

    out = R["output_path"]
    doc = SimpleDocTemplate(
        out, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=18*mm, bottomMargin=22*mm,
        title=R["title"],
    )
    story = []
    render_page1(story, R)
    for sheet in R["sheets"]:
        renderer = {
            "services": render_services_sheet,
            "electricity_monthly": render_electricity_monthly_sheet,
            "payments": render_payments_sheet,
        }.get(sheet["type"])
        if not renderer:
            raise ValueError(f"Unknown sheet type: {sheet['type']!r}")
        renderer(story, sheet)
    render_payment_instruction(story, R)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"PDF vytvořeno: {out}")


if __name__ == "__main__":
    build_pdf(RECONCILIATION)
