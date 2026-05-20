#!/usr/bin/env python3
"""
Generate the ABXTAC Wellness Protocols — Staff Training Manual (PDF).

Builds a polished, multi-page training manual covering every peptide carried on
the ABXTAC website (abxtac.com), organized into the 11 therapeutic categories
already used for WooCommerce categorization (see scripts/wc-categorize-peptides.js).

For each peptide: what it is, how it works, benefits, the commonly-referenced
protocol (dose / route / frequency), cycling, stacking, customer talking points,
and cautions. Also includes goal-based protocol playbooks (weight loss,
performance, skincare, sexual health, cognitive, sleep, longevity) and a
Hannah memorization + practice section (flashcards, quiz, roleplay scripts).

Usage:  python3 scripts/generate-wellness-protocols.py
Output: docs/wellness-protocols/ABXTAC-Wellness-Protocols-Staff-Training.pdf

Dosing reflects commonly-cited reference protocols for staff education. Actual
dosing for any client is always directed by the prescribing provider.
"""

import os
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
    Table, TableStyle, ListFlowable, ListItem, KeepTogether, HRFlowable,
)

# ── Brand palette ───────────────────────────────────────────────────────────
NAVY   = colors.HexColor("#0f2540")
TEAL   = colors.HexColor("#0e7c86")
GOLD   = colors.HexColor("#c79a3a")
SLATE  = colors.HexColor("#3a4654")
LIGHT  = colors.HexColor("#eef2f5")
LINE   = colors.HexColor("#c9d3db")
RED    = colors.HexColor("#a83232")

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "wellness-protocols")
OUTPUT_PDF = os.path.join(OUTPUT_DIR, "ABXTAC-Wellness-Protocols-Staff-Training.pdf")

# ── Styles ──────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

def S(name, **kw):
    styles.add(ParagraphStyle(name=name, **kw))

S("CoverTitle", fontName="Helvetica-Bold", fontSize=34, textColor=colors.white,
  leading=40, alignment=TA_CENTER, spaceAfter=10)
S("CoverSub", fontName="Helvetica", fontSize=15, textColor=GOLD,
  leading=20, alignment=TA_CENTER, spaceAfter=6)
S("CoverMeta", fontName="Helvetica", fontSize=10.5, textColor=colors.white,
  leading=15, alignment=TA_CENTER)
S("H1", fontName="Helvetica-Bold", fontSize=20, textColor=NAVY, leading=24,
  spaceBefore=4, spaceAfter=10)
S("H2", fontName="Helvetica-Bold", fontSize=14.5, textColor=TEAL, leading=18,
  spaceBefore=14, spaceAfter=6)
S("H3", fontName="Helvetica-Bold", fontSize=12, textColor=NAVY, leading=15,
  spaceBefore=8, spaceAfter=3)
S("Body", fontName="Helvetica", fontSize=10, textColor=SLATE, leading=14.5,
  alignment=TA_JUSTIFY, spaceAfter=5)
S("BodyL", fontName="Helvetica", fontSize=10, textColor=SLATE, leading=14.5,
  alignment=TA_LEFT, spaceAfter=5)
S("Bull", fontName="Helvetica", fontSize=9.7, textColor=SLATE, leading=13.5)
S("Small", fontName="Helvetica", fontSize=8.5, textColor=colors.HexColor("#5b6975"),
  leading=11.5)
S("Lead", fontName="Helvetica-Oblique", fontSize=11, textColor=SLATE, leading=16,
  spaceAfter=8)
S("Card", fontName="Helvetica-Bold", fontSize=12.5, textColor=colors.white, leading=15)
S("CardSku", fontName="Helvetica", fontSize=8.5, textColor=colors.white, leading=11)
S("TblHead", fontName="Helvetica-Bold", fontSize=9, textColor=colors.white, leading=12)
S("TblCell", fontName="Helvetica", fontSize=8.8, textColor=SLATE, leading=12)
S("TblCellB", fontName="Helvetica-Bold", fontSize=8.8, textColor=NAVY, leading=12)
S("Quiz", fontName="Helvetica", fontSize=10, textColor=SLATE, leading=15, spaceAfter=3)
S("Answer", fontName="Helvetica-Oblique", fontSize=9.3, textColor=TEAL, leading=13,
  spaceAfter=8)
S("Flash", fontName="Helvetica", fontSize=9.3, textColor=SLATE, leading=13)


def bullets(items, style="Bull", gap=2):
    return ListFlowable(
        [ListItem(Paragraph(t, styles[style]), value="•", spaceb=gap) for t in items],
        bulletType="bullet", start="•", leftIndent=16, bulletColor=TEAL,
    )


def field_table(rows):
    """Two-column label/value table used inside peptide profiles."""
    data = []
    for label, value in rows:
        data.append([Paragraph(label, styles["TblCellB"]), Paragraph(value, styles["TblCell"])])
    t = Table(data, colWidths=[1.15 * inch, 5.55 * inch])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), LIGHT),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE),
        ("LINEBEFORE", (1, 0), (1, -1), 0.5, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def peptide_card(name, skus):
    bar = Table([[Paragraph(name, styles["Card"]),
                  Paragraph(skus, styles["CardSku"])]],
                colWidths=[4.9 * inch, 1.8 * inch])
    bar.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return bar


def profile(p):
    """Render one peptide profile as a keep-together block."""
    flow = [peptide_card(p["name"], p.get("skus", "")), Spacer(1, 4)]
    flow.append(Paragraph(p["what"], styles["Body"]))
    rows = []
    if p.get("benefits"):
        rows.append(("Benefits", " &bull; ".join(p["benefits"])))
    if p.get("protocol"):
        rows.append(("Protocol", p["protocol"]))
    if p.get("cycle"):
        rows.append(("Cycling", p["cycle"]))
    if p.get("stack"):
        rows.append(("Stacks well with", p["stack"]))
    if p.get("talk"):
        rows.append(("Talking points", p["talk"]))
    if p.get("caution"):
        rows.append(("Cautions", p["caution"]))
    flow.append(field_table(rows))
    flow.append(Spacer(1, 12))
    # First card of a category often safe to keep together; large ones we let flow.
    return flow


def callout(title, body, color=GOLD):
    box = Table([[Paragraph(f"<b>{title}</b>  {body}", styles["BodyL"])]],
                colWidths=[6.7 * inch])
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("LINEBEFORE", (0, 0), (0, -1), 4, color),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    return box


# ── Page furniture ───────────────────────────────────────────────────────────
def cover_page(canvas, doc):
    canvas.saveState()
    w, h = letter
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.rect(0, h - 2.0 * inch, w, 0.10 * inch, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, 2.0 * inch, w, 0.10 * inch, fill=1, stroke=0)
    canvas.restoreState()


def content_page(canvas, doc):
    canvas.saveState()
    w, h = letter
    canvas.setFillColor(NAVY)
    canvas.rect(0, h - 0.62 * inch, w, 0.62 * inch, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawString(0.75 * inch, h - 0.40 * inch, "ABXTAC  •  WELLNESS PROTOCOLS")
    canvas.setFillColor(GOLD)
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(w - 0.75 * inch, h - 0.40 * inch, "STAFF TRAINING MANUAL")
    # footer
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(0.75 * inch, 0.55 * inch, w - 0.75 * inch, 0.55 * inch)
    canvas.setFillColor(SLATE)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(0.75 * inch, 0.38 * inch,
                      "Confidential — internal training. Not medical advice. Provider directs all dosing.")
    canvas.drawRightString(w - 0.75 * inch, 0.38 * inch, f"Page {doc.page - 1}")
    canvas.restoreState()


# ─────────────────────────────────────────────────────────────────────────────
# CONTENT
# ─────────────────────────────────────────────────────────────────────────────
def build_story():
    story = []

    # ---- COVER ----
    story.append(Spacer(1, 2.5 * inch))
    story.append(Paragraph("ABXTAC", styles["CoverSub"]))
    story.append(Paragraph("Wellness Protocols", styles["CoverTitle"]))
    story.append(Paragraph("Peptide Staff Training &amp; Reference Manual", styles["CoverSub"]))
    story.append(Spacer(1, 1.6 * inch))
    story.append(Paragraph(
        "Everything our team needs to understand, explain, and protocol every peptide "
        "we carry — organized by goal: weight loss, performance, skincare, sexual "
        "health, cognition, sleep, and longevity.", styles["CoverMeta"]))
    story.append(Spacer(1, 0.4 * inch))
    story.append(Paragraph("Version 1.0  •  Granite Mountain Health / ABXTAC", styles["CoverMeta"]))
    story.append(PageBreak())

    # ---- HOW TO USE ----
    story.append(Paragraph("How to Use This Manual", styles["H1"]))
    story.append(HRFlowable(width="100%", thickness=1.2, color=GOLD, spaceAfter=10))
    story.append(Paragraph(
        "This manual is the single training reference for the ABXTAC peptide line. It is built "
        "to be <b>learned</b>, not just looked up. Read it front to back once, then use the "
        "goal-based playbooks and quick-reference tables day to day.", styles["Body"]))
    story.append(Paragraph("It is organized in four layers:", styles["BodyL"]))
    story.append(bullets([
        "<b>Foundations</b> — what a peptide is, reconstitution, injection basics, and dosing math. Master this first; every product builds on it.",
        "<b>Goal-Based Playbooks</b> — how to think about a customer goal (weight loss, skin, performance, etc.) and which peptides serve it. This is how customers actually shop.",
        "<b>Peptide Profiles</b> — the full A-to-Z reference, grouped by our 11 therapeutic categories. One profile per peptide: what, how, benefits, protocol, stacks, cautions.",
        "<b>Memorize &amp; Practice</b> — flashcards, a self-quiz, and roleplay scripts. This is the section Hannah drills until it is automatic.",
    ]))
    story.append(Spacer(1, 4))
    story.append(callout("Scope &amp; framing.",
        "ABXTAC products are sold and discussed as research / wellness compounds. Staff educate; "
        "they never diagnose, prescribe, or promise outcomes. Any dosing in this manual is a "
        "commonly-referenced starting point for training — the prescribing provider sets the actual "
        "plan for every individual.", color=RED))
    story.append(Spacer(1, 8))
    story.append(callout("Vendor note.",
        "Our peptides are sourced from <b>Alpha BioMed</b> (never “Alpha Medical”). General "
        "medical supplies (needles, syringes, vial adapters) come from McKesson. Don’t mix these up "
        "when a customer asks about sourcing.", color=TEAL))
    story.append(PageBreak())

    # ---- FOUNDATIONS ----
    story.append(Paragraph("Part 1 — Peptide Foundations", styles["H1"]))
    story.append(HRFlowable(width="100%", thickness=1.2, color=GOLD, spaceAfter=10))

    story.append(Paragraph("What is a peptide?", styles["H2"]))
    story.append(Paragraph(
        "A peptide is a short chain of amino acids — the same building blocks that make proteins, "
        "just smaller. The body uses thousands of natural peptides as <b>signals</b>: tiny messages that "
        "tell cells to heal, release a hormone, burn fat, build tissue, or calm inflammation. "
        "Therapeutic peptides copy those signals. Because they are <b>targeted</b>, a well-chosen peptide "
        "can nudge one system (say, appetite or collagen production) with fewer of the broad side "
        "effects you get from blunt drugs.", styles["Body"]))
    story.append(Paragraph(
        "Most of our peptides come as a <b>lyophilized (freeze-dried) powder</b> in a sealed vial. They are "
        "shelf-stable as powder but must be <b>reconstituted</b> (mixed with sterile or bacteriostatic "
        "water) before use, and then refrigerated.", styles["Body"]))

    story.append(Paragraph("Reconstitution — the one skill everyone must know", styles["H2"]))
    story.append(bullets([
        "<b>Add water slowly</b> down the inside wall of the vial — never spray directly onto the powder. Let it dissolve on its own; do not shake. Swirl gently if needed.",
        "<b>Bacteriostatic water</b> (contains 0.9% benzyl alcohol) is preferred for multi-dose vials — it lets the vial be used over several weeks. Sterile water is single-use.",
        "The <b>amount of water you add is your choice</b> — it sets the concentration. More water = easier-to-measure but larger-volume doses; less water = tiny precise doses. The peptide milligrams do not change.",
        "Store reconstituted vials in the <b>refrigerator (2–8°C)</b>, away from light. Most last 4–8 weeks reconstituted. Powder, unopened, lasts far longer (often 2+ years) in a freezer.",
    ]))

    story.append(Paragraph("Dosing math — units vs. milligrams", styles["H2"]))
    story.append(Paragraph(
        "The most common customer confusion (and the most common dosing error) is mixing up "
        "<b>milligrams of peptide</b> with <b>units on the syringe</b>. Insulin syringes are marked in "
        "“units” (100 units = 1 mL). The conversion depends entirely on how much water was added.",
        styles["Body"]))
    ex = [
        [Paragraph("Vial strength", styles["TblHead"]),
         Paragraph("Water added", styles["TblHead"]),
         Paragraph("Concentration", styles["TblHead"]),
         Paragraph("For a 250&nbsp;mcg dose", styles["TblHead"])],
        [Paragraph("5 mg BPC-157", styles["TblCell"]),
         Paragraph("2 mL", styles["TblCell"]),
         Paragraph("2,500 mcg / mL", styles["TblCell"]),
         Paragraph("draw to 10 units (0.10 mL)", styles["TblCellB"])],
        [Paragraph("10 mg BPC-157", styles["TblCell"]),
         Paragraph("2 mL", styles["TblCell"]),
         Paragraph("5,000 mcg / mL", styles["TblCell"]),
         Paragraph("draw to 5 units (0.05 mL)", styles["TblCellB"])],
    ]
    t = Table(ex, colWidths=[1.5 * inch, 1.2 * inch, 1.5 * inch, 2.5 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(Spacer(1, 6))
    story.append(callout("Rule of thumb for staff:",
        "Always confirm two numbers before any dosing conversation — <b>(1)</b> how many mg are in the "
        "vial and <b>(2)</b> how many mL of water were added. Without both, a “units” number is meaningless. "
        "When in doubt, route to the provider.", color=RED))

    story.append(Paragraph("Routes of administration", styles["H2"]))
    story.append(bullets([
        "<b>Subcutaneous (SubQ)</b> — tiny insulin needle into fat (belly, thigh). The default for most peptides. Painless, easy, self-administered.",
        "<b>Intramuscular (IM)</b> — deeper, used for some hormones (HCG, HMG) and oils.",
        "<b>Intranasal</b> — sprays for brain-targeted peptides (Semax, Selank) that cross better via the nose.",
        "<b>Topical</b> — creams/serums for skin peptides (GHK-Cu, Snap-8, copper blends).",
        "<b>Oral</b> — a few are oral-active (5-Amino-1MQ capsules); most peptides are destroyed by digestion, which is why injection is the norm.",
    ]))
    story.append(PageBreak())

    # ---- THE 11 CATEGORIES OVERVIEW ----
    story.append(Paragraph("Part 2 — The 11 Categories at a Glance", styles["H1"]))
    story.append(HRFlowable(width="100%", thickness=1.2, color=GOLD, spaceAfter=10))
    story.append(Paragraph(
        "Every product on abxtac.com lives in one of these 11 therapeutic categories. Learn the "
        "category map first — it is the mental filing cabinet for everything that follows.",
        styles["Body"]))
    cat_rows = [[Paragraph("Category", styles["TblHead"]),
                 Paragraph("What it&rsquo;s for", styles["TblHead"]),
                 Paragraph("Headliners", styles["TblHead"])]]
    for c in CATEGORY_OVERVIEW:
        cat_rows.append([
            Paragraph(c[0], styles["TblCellB"]),
            Paragraph(c[1], styles["TblCell"]),
            Paragraph(c[2], styles["TblCell"]),
        ])
    t = Table(cat_rows, colWidths=[1.55 * inch, 2.75 * inch, 2.4 * inch], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(PageBreak())

    # ---- GOAL PLAYBOOKS ----
    story.append(Paragraph("Part 3 — Goal-Based Protocol Playbooks", styles["H1"]))
    story.append(HRFlowable(width="100%", thickness=1.2, color=GOLD, spaceAfter=10))
    story.append(Paragraph(
        "Customers don&rsquo;t shop by category — they shop by <b>goal</b>: “I want to lose weight,” "
        "“my skin,” “I want to recover faster.” These playbooks translate a goal into the right "
        "conversation and the right stack. Each follows the same shape: <i>who it&rsquo;s for, the core "
        "options, a starter protocol, and what to add.</i>", styles["Body"]))
    story.append(Spacer(1, 6))
    for pb in PLAYBOOKS:
        block = [Paragraph(pb["title"], styles["H2"]),
                 Paragraph(pb["who"], styles["Lead"])]
        block.append(Paragraph("Core options", styles["H3"]))
        block.append(bullets(pb["options"]))
        block.append(Paragraph("Starter protocol", styles["H3"]))
        block.append(callout("", pb["starter"], color=TEAL))
        block.append(Paragraph("Level-up / add-ons", styles["H3"]))
        block.append(bullets(pb["addons"]))
        if pb.get("note"):
            block.append(Spacer(1, 3))
            block.append(callout("Coach&rsquo;s note.", pb["note"], color=GOLD))
        block.append(Spacer(1, 10))
        story.append(KeepTogether(block) if pb.get("compact") else block_flow(block))
    story.append(PageBreak())

    # ---- PEPTIDE PROFILES ----
    story.append(Paragraph("Part 4 — Peptide Profiles (A–Z by Category)", styles["H1"]))
    story.append(HRFlowable(width="100%", thickness=1.2, color=GOLD, spaceAfter=8))
    story.append(Paragraph(
        "The complete reference. Each profile is self-contained — find the peptide, get the answer. "
        "Dosing shown is a typical reference range for training; the provider sets each plan.",
        styles["Body"]))
    story.append(Spacer(1, 6))

    for cat_name, intro, peps in CATEGORIES:
        cat_header = Table([[Paragraph(cat_name, styles["Card"])]], colWidths=[6.7 * inch])
        cat_header.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), TEAL),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ]))
        story.append(cat_header)
        story.append(Spacer(1, 4))
        story.append(Paragraph(intro, styles["Body"]))
        story.append(Spacer(1, 6))
        for p in peps:
            for f in profile(p):
                story.append(f)
        story.append(PageBreak())

    # ---- STACKING GUIDE ----
    story.append(Paragraph("Part 5 — Stacking Guide", styles["H1"]))
    story.append(HRFlowable(width="100%", thickness=1.2, color=GOLD, spaceAfter=10))
    story.append(Paragraph(
        "“Stacking” means running peptides together so their effects complement each other. These are "
        "the classic, well-understood combinations. Always confirm the provider has approved any stack.",
        styles["Body"]))
    stack_rows = [[Paragraph("Stack name", styles["TblHead"]),
                   Paragraph("Combination", styles["TblHead"]),
                   Paragraph("Goal", styles["TblHead"])]]
    for s in STACKS:
        stack_rows.append([Paragraph(s[0], styles["TblCellB"]),
                           Paragraph(s[1], styles["TblCell"]),
                           Paragraph(s[2], styles["TblCell"])])
    t = Table(stack_rows, colWidths=[1.6 * inch, 2.9 * inch, 2.2 * inch], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(Spacer(1, 10))
    story.append(callout("General stacking principles.",
        "Healing peptides (BPC/TB) pair with almost anything. GHRH + GH-secretagogue (CJC + Ipamorelin) "
        "is the gold-standard GH combo. Don&rsquo;t double up two drugs in the same class (e.g., two GLP "
        "agonists) without provider direction. Introduce one new peptide at a time so you can attribute "
        "effects and side effects.", color=TEAL))
    story.append(PageBreak())

    # ---- MEMORIZE & PRACTICE ----
    story.append(Paragraph("Part 6 — Memorize &amp; Practice (Hannah&rsquo;s Drill)", styles["H1"]))
    story.append(HRFlowable(width="100%", thickness=1.2, color=GOLD, spaceAfter=10))
    story.append(Paragraph(
        "This section turns the manual into recall. The goal: when a customer says a goal or names a "
        "peptide, the right answer comes out automatically — no flipping pages. Drill the flashcards "
        "daily for a week, then take the self-quiz cold, then run the roleplays out loud.",
        styles["Body"]))

    story.append(Paragraph("A. One-line flashcards", styles["H2"]))
    story.append(Paragraph("Cover the right column. Say the answer out loud before revealing.", styles["Small"]))
    fc_rows = [[Paragraph("Peptide", styles["TblHead"]),
                Paragraph("Say this in one breath", styles["TblHead"])]]
    for f in FLASHCARDS:
        fc_rows.append([Paragraph(f[0], styles["TblCellB"]),
                        Paragraph(f[1], styles["Flash"])])
    t = Table(fc_rows, colWidths=[1.9 * inch, 4.8 * inch], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(PageBreak())

    story.append(Paragraph("B. Self-quiz (answers in teal — cover them first)", styles["H2"]))
    for q, a in QUIZ:
        story.append(Paragraph(f"<b>Q.</b> {q}", styles["Quiz"]))
        story.append(Paragraph(f"A. {a}", styles["Answer"]))
    story.append(PageBreak())

    story.append(Paragraph("C. Customer roleplay scripts", styles["H2"]))
    story.append(Paragraph(
        "Practice these out loud with a partner. The point isn&rsquo;t to memorize words — it&rsquo;s to "
        "internalize the <b>flow</b>: listen, then identify the goal, then educate, then route to the provider "
        "for the actual plan. Never diagnose or promise results.", styles["Body"]))
    for r in ROLEPLAYS:
        block = [Paragraph(r["title"], styles["H3"])]
        for line in r["lines"]:
            who, txt = line
            color = TEAL if who == "Customer" else NAVY
            hexc = "#" + color.hexval()[2:]
            block.append(Paragraph(f"<b><font color='{hexc}'>{who}:</font></b> {txt}",
                                   styles["BodyL"]))
        block.append(Spacer(1, 8))
        story.append(KeepTogether(block))

    story.append(Spacer(1, 6))
    story.append(callout("The three things to never skip:",
        "(1) Ask the goal before recommending. (2) Educate on what it does and how it&rsquo;s taken — not a "
        "diagnosis or a cure. (3) Route every actual dosing/medical decision to the prescribing provider. "
        "When unsure, say “great question — let me get the provider to confirm that for you.”", color=RED))

    return story


def block_flow(block):
    """Return a flowable group (list) — reportlab accepts lists in story via extend."""
    return block


# ─────────────────────────────────────────────────────────────────────────────
# DATA
# ─────────────────────────────────────────────────────────────────────────────
CATEGORY_OVERVIEW = [
    ("Weight Management",
     "Appetite control, fat loss, metabolic rate. The flagship category — GLP-class drugs.",
     "Semaglutide, Tirzepatide, Retatrutide, Cagrilintide, AOD-9604"),
    ("Healing &amp; Tissue Repair",
     "Recovery from injury, gut/tendon/ligament repair, inflammation.",
     "BPC-157, TB-500, Wolverine, GHK-Cu, KLOW"),
    ("Growth Hormone",
     "Stimulate the body&rsquo;s own GH for muscle, fat loss, sleep, anti-aging.",
     "Sermorelin, CJC-1295, Ipamorelin, Tesamorelin, IGF-1 LR3"),
    ("Sexual Health",
     "Libido, arousal, fertility signaling — men and women.",
     "PT-141, Melanotan 2, Kisspeptin"),
    ("Cognitive &amp; Neuro",
     "Focus, mood, anxiety, neuroprotection.",
     "Semax, Selank, SS-31, Pinealon"),
    ("Anti-Aging &amp; Longevity",
     "Cellular energy, DNA/telomere support, senescent-cell clearance.",
     "NAD+, MOTS-c, Epitalon, FOXO4"),
    ("Sleep &amp; Recovery",
     "Deep sleep, nervous-system recovery, neuropathy.",
     "DSIP, VIP, ARA-290"),
    ("Immune Support",
     "Immune modulation, thymic function, anti-inflammatory.",
     "Thymosin Alpha-1, Thymalin, KPV"),
    ("Body Composition",
     "Muscle preservation/building and hormone support.",
     "HCG, HMG, ACE-031, AICAR"),
    ("Vitamins &amp; Lipotropics",
     "Energy, antioxidant, fat-metabolism injections.",
     "B12, Glutathione, MIC blends"),
    ("Supplies",
     "Everything needed to reconstitute and inject safely.",
     "Bacteriostatic water, syringes (via kit)"),
]

PLAYBOOKS = [
    {
        "title": "🔥 Goal: Weight Loss",
        "who": "The largest segment. Customers who want appetite control and steady fat loss, "
               "often after diets stopped working.",
        "options": [
            "<b>Semaglutide (GLP-1)</b> — the well-known once-weekly. Strong appetite suppression, proven, gentlest entry point.",
            "<b>Tirzepatide (GLP-1 + GIP)</b> — dual-action; typically greater weight loss than semaglutide, also weekly.",
            "<b>Retatrutide (GLP-1 + GIP + glucagon)</b> — triple-action, the most powerful of the GLP class; for aggressive goals under close provider guidance.",
            "<b>Cagrilintide</b> — an amylin analog, often paired with semaglutide (“CagriSema”) for added appetite control.",
            "<b>AOD-9604 &amp; MIC/lipotropic blends</b> — gentler, non-GLP fat-metabolism support for customers who can&rsquo;t or won&rsquo;t do GLP drugs.",
        ],
        "starter": "Most common: <b>Semaglutide</b>, start 0.25&nbsp;mg SubQ once weekly, titrate up every 4 weeks "
                   "as tolerated toward 1.0–2.4&nbsp;mg. Pair with protein-forward eating and resistance training "
                   "to protect muscle. <i>Provider sets the titration schedule.</i>",
        "addons": [
            "Add <b>Tesamorelin</b> or a CJC/Ipamorelin GH stack to preserve lean muscle and target visceral belly fat during a calorie deficit.",
            "Add <b>5-Amino-1MQ</b> (oral) or <b>MOTS-c</b> for metabolic/fat-oxidation support.",
            "<b>Glutathione + B12</b> for energy and to feel good through the deficit.",
        ],
        "note": "Set expectations honestly: GLP drugs work best <i>with</i> diet and training, not instead of them. "
                "Common early side effects are nausea and constipation — usually fade with slow titration. "
                "Muscle loss is the #1 mistake; always pair with protein + resistance work.",
    },
    {
        "title": "💪 Goal: Performance &amp; Recovery",
        "who": "Athletes, lifters, weekend warriors, and anyone recovering from injury or surgery who "
               "wants to train harder and bounce back faster.",
        "options": [
            "<b>BPC-157 + TB-500 (“Wolverine”)</b> — the recovery backbone: tendons, ligaments, muscle, gut.",
            "<b>CJC-1295 + Ipamorelin</b> — the GH stack for recovery, body composition, and sleep.",
            "<b>IGF-1 LR3</b> — direct muscle growth signaling for advanced users.",
            "<b>MOTS-c / AICAR / SLU-PP-332</b> — endurance and “exercise-mimetic” metabolic support.",
        ],
        "starter": "Injury/recovery: <b>BPC-157</b> 250–500&nbsp;mcg SubQ once or twice daily (often near the injury site) "
                   "+ <b>TB-500</b> ~2–2.5&nbsp;mg twice weekly for 4–6 weeks. Performance/body-comp: <b>CJC-1295 + "
                   "Ipamorelin</b> dosed at night before bed.",
        "addons": [
            "Add <b>NAD+</b> for cellular energy and recovery.",
            "Add <b>Glutathione</b> to manage oxidative stress from hard training.",
            "<b>Sleep stack (DSIP)</b> — recovery happens during sleep.",
        ],
        "note": "Note for any competitive athlete: many of these are on sport anti-doping banned lists. "
                "Flag that proactively — it&rsquo;s a trust-builder, and it&rsquo;s the right thing to do.",
    },
    {
        "title": "✨ Goal: Skin, Hair &amp; Beauty",
        "who": "Skincare-focused customers — anti-aging, glow, hair, wound/scar healing. A fast-growing segment "
               "and a natural cross-sell from weight loss.",
        "options": [
            "<b>GHK-Cu (copper peptide)</b> — the star: collagen, skin firmness, wound healing, hair growth. Injectable and topical.",
            "<b>GLOW blend (GHK-Cu + BPC + TB)</b> — “inside-out” glow: skin + healing in one.",
            "<b>KLOW blend (GHK-Cu + KPV + BPC + TB)</b> — adds anti-inflammatory KPV for reactive/irritated skin.",
            "<b>Snap-8</b> — topical “Botox-in-a-bottle” peptide that softens expression lines.",
            "<b>Glutathione</b> — antioxidant, skin brightening/even tone.",
            "<b>Epitalon</b> — longevity peptide with skin-quality and sleep benefits.",
        ],
        "starter": "Entry skincare stack: <b>GHK-Cu</b> (topical serum daily and/or low-dose SubQ) for collagen + glow, "
                   "plus <b>Glutathione</b> for brightening. Add <b>Snap-8</b> topically for fine lines.",
        "addons": [
            "<b>Melanotan 2</b> for customers specifically wanting a tan (set expectations on freckling/moles).",
            "<b>BPC-157</b> for scar/wound healing after procedures.",
            "<b>Sermorelin / GH stack</b> — better skin thickness and elasticity is a known GH-optimization benefit.",
        ],
        "note": "Skincare is the easiest “first peptide” for nervous customers — topicals feel low-risk. Use it as the "
                "on-ramp, then educate on the systemic options.",
    },
    {
        "title": "❤️ Goal: Sexual Health &amp; Libido",
        "who": "Men and women with low libido or arousal concerns. Often sensitive — lead with discretion and empathy.",
        "options": [
            "<b>PT-141 (Bremelanotide)</b> — works on the brain&rsquo;s arousal pathway (not blood flow), so it works for both men and women. Taken before activity.",
            "<b>Kisspeptin</b> — upstream hormone signaling; libido and fertility support.",
            "<b>Melanotan 2</b> — has a libido side-benefit alongside tanning.",
        ],
        "starter": "<b>PT-141</b> ~1–2&nbsp;mg SubQ roughly 45 minutes before intimacy, not daily. Start low — nausea and "
                   "flushing are dose-related.",
        "addons": [
            "For men, this often pairs with a provider&rsquo;s TRT or <b>HCG</b> protocol — route hormone questions to the provider.",
            "<b>Kisspeptin</b> for an upstream, more “natural-axis” approach.",
        ],
        "note": "Keep these conversations private and matter-of-fact. PT-141&rsquo;s big selling point: it works on desire "
                "centrally, so it helps people for whom “blood-flow” ED drugs don&rsquo;t address the real issue.",
    },
    {
        "title": "🧠 Goal: Focus, Mood &amp; Sleep",
        "who": "Customers wanting sharper focus, calmer mood, less anxiety, or deeper sleep — often busy "
               "professionals and the wellness-curious.",
        "options": [
            "<b>Semax</b> — nootropic; focus, mental energy, neuroprotection (intranasal).",
            "<b>Selank</b> — calming/anti-anxiety nootropic without sedation (intranasal).",
            "<b>DSIP</b> — delta sleep-inducing peptide for deeper sleep.",
            "<b>Pinealon / Epitalon</b> — brain and circadian-rhythm support.",
        ],
        "starter": "Focus: <b>Semax</b> intranasal in the morning. Calm: <b>Selank</b> intranasal as needed. "
                   "Sleep: <b>DSIP</b> before bed, or <b>Epitalon</b> in cycles for circadian support.",
        "addons": [
            "<b>NAD+</b> for mental clarity and energy.",
            "<b>SS-31</b> for mitochondrial support in fatigue-driven brain fog.",
        ],
        "note": "Semax + Selank together is a popular “focused but calm” daytime pairing.",
    },
    {
        "title": "⏳ Goal: Longevity &amp; Immune",
        "who": "Proactive health optimizers focused on aging well, energy, and immune resilience.",
        "options": [
            "<b>NAD+</b> — cellular energy and DNA repair; the cornerstone longevity molecule.",
            "<b>Epitalon</b> — telomere/pineal support, sleep, longevity cycles.",
            "<b>MOTS-c</b> — mitochondrial &amp; metabolic longevity.",
            "<b>FOXO4-DRI</b> — senolytic (clears “zombie” senescent cells); advanced, cyclical.",
            "<b>Thymosin Alpha-1 / Thymalin</b> — immune modulation and thymic support.",
        ],
        "starter": "Foundational longevity: <b>NAD+</b> (titrate slowly — too fast causes flushing) + a cyclical "
                   "<b>Epitalon</b> course. Immune resilience: <b>Thymosin Alpha-1</b>.",
        "addons": [
            "<b>Glutathione</b> as the master antioxidant.",
            "<b>GH stack</b> for body-composition and recovery aspects of aging.",
        ],
        "note": "Longevity customers love the “why” — they&rsquo;ll engage with mechanism. This is where deep product "
                "knowledge pays off most.",
    },
]

# ── Peptide profiles by category ─────────────────────────────────────────────
CATEGORIES = [
    ("WEIGHT MANAGEMENT",
     "The flagship line. These are the GLP-class “incretin” drugs plus supporting fat-metabolism "
     "peptides. The core mechanism: mimic gut hormones that tell the brain you&rsquo;re full and slow "
     "stomach emptying, so people eat less without willpower battles.",
     [
        {"name": "Semaglutide (GLP-1)", "skus": "YPB.200–202 (10/20/30 mg)",
         "what": "A GLP-1 receptor agonist — the same class as Ozempic/Wegovy. It mimics the gut hormone "
                 "GLP-1 to suppress appetite, slow gastric emptying (you feel full longer), and improve "
                 "blood-sugar control. The most-requested product in the line and the gentlest GLP entry point.",
         "benefits": ["Strong appetite suppression", "Steady weight loss", "Better blood-sugar control",
                      "Once-weekly dosing"],
         "protocol": "Start 0.25 mg SubQ once weekly &times; 4 weeks, then titrate up every 4 weeks "
                     "(0.5 then 1.0, 1.7, up to 2.4 mg) as tolerated. Weekly injection, same day each week.",
         "cycle": "Run continuously while losing; provider manages a maintenance dose or taper.",
         "stack": "Cagrilintide (CagriSema), Tesamorelin or CJC/Ipamorelin to protect muscle, B12 for energy.",
         "talk": "“The well-known weekly shot. It works by making you feel full sooner and longer. Works best "
                 "with protein and resistance training so you lose fat, not muscle.”",
         "caution": "Nausea/constipation early (titrate slowly). Not with personal/family history of medullary "
                    "thyroid cancer or MEN2. Provider screens. Protect muscle with protein + training."},
        {"name": "Tirzepatide (GLP-1 / GIP)", "skus": "YPB.203–208 (10–60 mg)",
         "what": "A dual agonist hitting both GLP-1 and GIP receptors (the Mounjaro/Zepbound molecule). The "
                 "second receptor adds metabolic and appetite effects, so weight loss is typically greater "
                 "than semaglutide for many people.",
         "benefits": ["Greater average weight loss than GLP-1 alone", "Appetite + metabolic effect",
                      "Once-weekly", "Strong blood-sugar control"],
         "protocol": "Start 2.5 mg SubQ weekly &times; 4 weeks, titrate by 2.5 mg every 4 weeks toward 10–15 mg "
                     "as tolerated.",
         "cycle": "Continuous during loss; provider manages maintenance.",
         "stack": "Same supportive stacks as semaglutide; do not combine with another GLP agonist.",
         "talk": "“The dual-action upgrade — it works on two appetite/metabolism pathways instead of one, so "
                 "many people see more loss. Same easy weekly shot.”",
         "caution": "Same class cautions as semaglutide; GI side effects can be a bit stronger — titrate slowly."},
        {"name": "Retatrutide (GLP-1 / GIP / Glucagon)", "skus": "YPB.209–210, 234–236, 287",
         "what": "A triple agonist — GLP-1, GIP, and glucagon receptors. The glucagon arm adds energy "
                 "expenditure/fat burning on top of appetite control. Investigational and the most powerful "
                 "of the GLP class; reserved for aggressive goals under close provider guidance.",
         "benefits": ["Highest weight-loss potential of the class", "Adds energy expenditure",
                      "Once-weekly"],
         "protocol": "Start 1–2 mg SubQ weekly, titrate slowly toward 8–12 mg under provider direction.",
         "cycle": "Continuous; close monitoring.",
         "stack": "Generally run solo within the GLP class.",
         "talk": "“The newest, strongest option — three pathways. Because it&rsquo;s so potent we go slow and the "
                 "provider watches it closely.”",
         "caution": "Most potent of the class, so the most GI/appetite effect. Investigational. Provider-directed only; slow titration."},
        {"name": "Cagrilintide", "skus": "YPB.239–241",
         "what": "A long-acting amylin analog. Amylin is a second satiety hormone (released with insulin). "
                 "It complements GLP-1 drugs — the famous “CagriSema” pairing combines cagrilintide with "
                 "semaglutide for additive appetite control.",
         "benefits": ["Added satiety", "Synergistic with GLP-1", "Slows gastric emptying"],
         "protocol": "Weekly SubQ, titrated; commonly run with semaglutide. Provider sets ratio/dose.",
         "stack": "Semaglutide (CagriSema).",
         "talk": "“A different fullness hormone — stacking it with semaglutide hits appetite from two angles.”",
         "caution": "GI effects; same slow-titration logic. Provider-directed combination."},
        {"name": "Mazdutide &amp; Survodutide", "skus": "YPB.269, YPB.278",
         "what": "Both are GLP-1 / glucagon dual agonists (investigational). Similar idea to tirzepatide but "
                 "with a glucagon arm instead of GIP — appetite control plus increased energy expenditure and "
                 "potential liver-fat benefits.",
         "benefits": ["Appetite + energy expenditure", "Emerging liver-fat data", "Weekly"],
         "protocol": "Titrated weekly SubQ, provider-directed.",
         "talk": "“Newer dual-action options in the same family — we&rsquo;d let the provider decide if they fit "
                 "better than the mainstream choices.”",
         "caution": "Investigational; provider-directed; class GI effects."},
        {"name": "AOD-9604", "skus": "YPB.248",
         "what": "A modified fragment of growth hormone (the 176–191 region) that targets fat metabolism "
                 "(lipolysis) <i>without</i> the blood-sugar or growth effects of full GH. A gentler, "
                 "non-GLP fat-loss aid.",
         "benefits": ["Stimulates fat breakdown", "No GH-style side effects", "Good for GLP-averse customers"],
         "protocol": "~300 mcg SubQ daily, often fasted/morning.",
         "stack": "GLP drugs, MIC/lipotropics, GH stacks.",
         "talk": "“A gentle, non-GLP fat-metabolism helper — a fragment of GH that just tells fat cells to "
                 "release stored fat.”",
         "caution": "Mild; effects are subtle vs. GLP drugs — set expectations."},
        {"name": "5-Amino-1MQ &amp; SLU-PP-332", "skus": "YPB.242, 247, 243",
         "what": "<b>5-Amino-1MQ</b> is an oral NNMT inhibitor that supports fat metabolism and lean mass. "
                 "<b>SLU-PP-332</b> is an “exercise-mimetic” (ERR agonist) that boosts fat oxidation and "
                 "endurance — like signaling “you just worked out.”",
         "benefits": ["Fat metabolism support", "5-Amino-1MQ is oral (no injection)", "Endurance / exercise-mimetic"],
         "protocol": "5-Amino-1MQ: oral capsule daily. SLU-PP-332: SubQ, provider-directed.",
         "talk": "“For customers who want metabolic support without a shot, 5-Amino-1MQ is an oral option.”",
         "caution": "Research compounds; subtle effects; adjuncts not standalone solutions."},
     ]),
    ("HEALING &amp; TISSUE REPAIR",
     "The recovery toolkit — repair tissue, calm inflammation, and improve gut and skin integrity. "
     "BPC-157 and TB-500 are the workhorses; the copper peptides bridge into skincare.",
     [
        {"name": "BPC-157", "skus": "YPB.212/213/237 (5/10/20 mg)",
         "what": "“Body Protective Compound” — a peptide derived from a protein in stomach acid. It promotes "
                 "angiogenesis (new blood-vessel growth) to speed healing of tendons, ligaments, muscle, and "
                 "especially the gut lining. The single most popular healing peptide.",
         "benefits": ["Tendon/ligament/muscle repair", "Gut healing (ulcers, leaky gut, IBD-type issues)",
                      "Reduces inflammation", "Protects the gut from NSAIDs"],
         "protocol": "250–500 mcg SubQ 1–2&times;/day, often injected near the injury site. Courses of 4–8 weeks.",
         "cycle": "Run through the injury/healing window, then stop.",
         "stack": "TB-500 (“Wolverine”), GHK-Cu, GH stack for connective tissue.",
         "talk": "“The go-to healing peptide — great for nagging tendon/joint injuries and for gut health. "
                 "People often inject it close to the sore area.”",
         "caution": "Well-tolerated. Banned in competitive sport. Quality/source matters — ours is Alpha BioMed."},
        {"name": "TB-500 (Thymosin Beta-4 fragment)", "skus": "YPB.214/215 (5/10 mg)",
         "what": "A synthetic version of a region of Thymosin Beta-4. It regulates actin (a cell-building "
                 "protein), improving cell migration to injury sites — so it boosts flexibility, reduces "
                 "scar tissue, and aids systemic, whole-body healing.",
         "benefits": ["Whole-body / systemic healing", "Flexibility &amp; reduced adhesions", "Muscle &amp; tendon repair"],
         "protocol": "~2–2.5 mg SubQ twice weekly as a loading phase (4–6 weeks), then a maintenance dose.",
         "cycle": "Loading phase then maintenance; cycle off when healed.",
         "stack": "BPC-157 (the classic recovery duo).",
         "talk": "“The systemic partner to BPC — works body-wide on flexibility and recovery, where BPC is "
                 "great for a specific spot.”",
         "caution": "Banned in sport. Loading dose then taper."},
        {"name": "Wolverine Blend (BPC-157 + TB-500)", "skus": "YPB.216/217 (5/10 mg)",
         "what": "A pre-combined blend of the two recovery workhorses in one vial — local + systemic healing "
                 "together. Named for the comic-book fast-healing factor. The easiest single-product recovery answer.",
         "benefits": ["Combined local + systemic healing", "One injection instead of two", "Faster recovery"],
         "protocol": "Dosed per the blend ratio, typically daily-to-several-times-weekly for 4–6 weeks.",
         "talk": "“Both healing peptides in one shot — the convenient, complete recovery option.”",
         "caution": "Banned in sport; same as components."},
        {"name": "GHK-Cu (Copper Peptide)", "skus": "YPB.221/222 (50/100 mg)",
         "what": "A naturally occurring copper-binding tripeptide. A powerhouse for skin and tissue: it drives "
                 "collagen and elastin production, wound healing, hair-follicle stimulation, and has "
                 "antioxidant/anti-inflammatory effects. Used both injected and topically.",
         "benefits": ["Collagen &amp; elastin (firmer skin)", "Wound &amp; scar healing", "Hair growth",
                      "Antioxidant / anti-inflammatory"],
         "protocol": "Topical serum daily for skin; low-dose SubQ for systemic skin/tissue benefits. "
                     "Provider-directed for injection.",
         "stack": "BPC/TB (GLOW, KLOW blends), Glutathione, Snap-8 topically.",
         "talk": "“The copper peptide — the star of our skincare line. Builds collagen, heals skin, even helps "
                 "hair. Works as a serum or an injection.”",
         "caution": "Topical can tint blue-green (it&rsquo;s copper). Avoid pairing topical with strong acids/retinoids "
                    "at the same time."},
        {"name": "GLOW Blend (GHK-Cu + BPC + TB)", "skus": "YPB.218",
         "what": "An “inside-out” beauty + healing blend: the copper peptide for skin combined with the two "
                 "healing peptides. Marketed for skin glow, recovery, and overall tissue quality in one product.",
         "benefits": ["Skin glow + collagen", "Whole-body healing", "Convenient all-in-one"],
         "protocol": "Per-blend dosing, typically daily SubQ in cycles.",
         "talk": "“Our signature glow stack — skin, hair, and healing in one vial.”",
         "caution": "Combination of three; introduce when client tolerates components."},
        {"name": "KLOW Blend (GHK-Cu + KPV + BPC + TB)", "skus": "YPB.264",
         "what": "GLOW plus KPV, an anti-inflammatory tripeptide. The added KPV makes it the choice for "
                 "reactive, inflamed, or gut-linked skin issues — comprehensive skin + recovery + calm.",
         "benefits": ["Everything GLOW does", "Adds anti-inflammatory KPV", "Best for irritated/reactive skin"],
         "protocol": "Per-blend dosing, daily SubQ in cycles.",
         "talk": "“The upgraded glow blend — adds an anti-inflammatory peptide, so it&rsquo;s ideal if skin is "
                 "reactive or there&rsquo;s a gut-skin connection.”",
         "caution": "Four-component blend; provider-directed."},
        {"name": "LL-37", "skus": "YPB.244",
         "what": "The body&rsquo;s own antimicrobial peptide (a cathelicidin). It fights microbes, modulates "
                 "immune response, and aids wound healing — used in research for chronic infection, gut, and "
                 "skin contexts.",
         "benefits": ["Antimicrobial", "Immune modulation", "Wound healing"],
         "protocol": "Low-dose SubQ, provider-directed cycles.",
         "talk": "“A natural antimicrobial peptide — used for stubborn infections and immune/gut support.”",
         "caution": "Can transiently provoke immune response; provider-directed."},
     ]),
    ("GROWTH HORMONE (Secretagogues &amp; GHRH)",
     "Instead of injecting synthetic HGH, these prompt the body to release <i>its own</i> growth hormone "
     "— for muscle, fat loss, recovery, sleep, and anti-aging. The classic move is to pair a GHRH "
     "(tells the pituitary to make GH) with a secretagogue (tells it to release a pulse).",
     [
        {"name": "Sermorelin", "skus": "YPB.211 (10 mg)",
         "what": "A GHRH analog — the foundational, gentle GH stimulator. It nudges the pituitary to produce "
                 "and release GH in a natural pulsatile pattern, so levels stay physiologic. A common first "
                 "GH-optimization product.",
         "benefits": ["Natural GH increase", "Better sleep", "Recovery, body composition, skin"],
         "protocol": "~200–300 mcg SubQ nightly before bed (GH releases during deep sleep).",
         "cycle": "Often run 5 days on / 2 off, in multi-month cycles.",
         "stack": "Ipamorelin (GHRH + secretagogue synergy).",
         "talk": "“The gentle entry to GH optimization — helps your own GH come back up. Most people notice sleep "
                 "and recovery first.”",
         "caution": "Inject on an empty stomach (food/carbs blunt the GH pulse). Mild water retention possible."},
        {"name": "CJC-1295 (with &amp; without DAC)", "skus": "YPB.219, YPB.220",
         "what": "A more potent GHRH analog. <b>With DAC</b> it&rsquo;s long-acting (steady GH elevation, dose ~weekly). "
                 "<b>Without DAC</b> (“Mod GRF 1-29”) is short-acting for clean GH pulses, usually stacked with "
                 "Ipamorelin and dosed daily.",
         "benefits": ["Stronger GH stimulation than Sermorelin", "Flexible (steady vs. pulsatile)",
                      "Muscle, fat loss, recovery"],
         "protocol": "No-DAC: ~100 mcg SubQ with Ipamorelin, 1–2&times;/day before bed/fasted. With-DAC: weekly dosing.",
         "stack": "Ipamorelin — the gold-standard GH pair.",
         "talk": "“A stronger GH-releasing peptide. We almost always pair the daily version with Ipamorelin for "
                 "a clean GH pulse.”",
         "caution": "Fasted dosing for pulse versions. Water retention/tingling possible early."},
        {"name": "Ipamorelin", "skus": "YPB.263 (10 mg)",
         "what": "A selective GH secretagogue (a ghrelin-receptor mimic). It triggers a clean GH pulse "
                 "<i>without</i> raising cortisol, prolactin, or hunger — which is why it&rsquo;s the preferred "
                 "secretagogue and the standard partner for CJC-1295.",
         "benefits": ["Clean GH pulse (no cortisol/prolactin spike)", "Recovery, sleep, lean mass", "Well-tolerated"],
         "protocol": "~200–300 mcg SubQ, 1–3&times;/day (commonly before bed), paired with CJC-1295.",
         "stack": "CJC-1295 (the classic stack), Sermorelin.",
         "talk": "“The clean GH-release peptide — no hunger or cortisol spike. It&rsquo;s the partner to CJC for the "
                 "best GH effect.”",
         "caution": "Very well-tolerated. Fasted dosing maximizes the pulse."},
        {"name": "Tesamorelin", "skus": "YPB.279/288 (10/20 mg)",
         "what": "A potent GHRH analog that is FDA-approved (as Egrifta) specifically to reduce <b>visceral "
                 "(deep belly) fat</b>. The standout GH peptide when the goal is targeting stubborn abdominal fat.",
         "benefits": ["Targets visceral belly fat", "Raises GH/IGF-1", "Cognitive &amp; metabolic benefits"],
         "protocol": "~1–2 mg SubQ daily (often at night).",
         "stack": "Ipamorelin; pairs with GLP weight-loss protocols to protect muscle.",
         "talk": "“The one specifically known for shrinking deep belly fat — it&rsquo;s even FDA-approved for that "
                 "purpose. Great alongside a weight-loss plan.”",
         "caution": "Daily injection; can affect blood sugar — provider monitors."},
        {"name": "IGF-1 LR3 &amp; IGF-DES", "skus": "YPB.262/285 (1/0.1 mg), YPB.286",
         "what": "GH works largely <i>through</i> IGF-1. <b>IGF-1 LR3</b> is a long-acting form that directly "
                 "signals muscle growth and nutrient partitioning. <b>IGF-DES</b> is a variant favored for "
                 "localized muscle effect. Advanced, potent — used by experienced clients.",
         "benefits": ["Direct muscle growth signaling", "Nutrient partitioning", "Localized growth (DES)"],
         "protocol": "Low microgram doses SubQ, often post-workout; advanced/provider-directed.",
         "stack": "GH-releasing stacks; not for beginners.",
         "talk": "“The advanced muscle-builder — it&rsquo;s what GH works through. We&rsquo;d only set this up with the "
                 "provider for experienced users.”",
         "caution": "Can drop blood sugar (hypoglycemia risk). Advanced only; provider-directed."},
        {"name": "GHRP-6 &amp; Hexarelin", "skus": "YPB.257/282, YPB.261",
         "what": "Older, potent GH secretagogues. <b>GHRP-6</b> strongly stimulates GH and also appetite "
                 "(useful for hard-gainers). <b>Hexarelin</b> is one of the most potent GH releasers. Both "
                 "predate Ipamorelin, which is now preferred for being cleaner.",
         "benefits": ["Strong GH release", "GHRP-6 boosts appetite", "Recovery/mass"],
         "protocol": "~100 mcg SubQ, fasted; provider-directed.",
         "talk": "“Stronger but older GH-release peptides — GHRP-6 also bumps appetite if someone struggles "
                 "to eat enough.”",
         "caution": "Can raise cortisol/prolactin and cause hunger; Ipamorelin is the cleaner default."},
        {"name": "DSIP &amp; GDF-8", "skus": "YPB.230/252 (15/5 mg), YPB.233",
         "what": "<b>DSIP</b> (Delta Sleep-Inducing Peptide) promotes deep sleep and supports the GH that "
                 "releases during it. <b>GDF-8</b> relates to myostatin (the muscle-limiting protein) and is a "
                 "research compound in muscle work.",
         "benefits": ["DSIP: deeper sleep + GH support", "Recovery", "GDF-8: myostatin research"],
         "protocol": "DSIP: low dose SubQ before bed. GDF-8: research, provider-directed.",
         "talk": "“DSIP is our sleep-and-recovery peptide — deep sleep is when GH does its work.”",
         "caution": "GDF-8 is research-grade; provider-directed."},
     ]),
    ("SEXUAL HEALTH",
     "Libido and arousal peptides for men and women. The standout is PT-141, which works centrally "
     "(in the brain) rather than on blood flow — so it helps when traditional ED drugs don&rsquo;t.",
     [
        {"name": "PT-141 (Bremelanotide)", "skus": "YPB.274 (10 mg)",
         "what": "A melanocortin-receptor agonist that increases sexual desire and arousal by acting on the "
                 "<b>brain&rsquo;s arousal pathways</b> — not blood vessels. That central mechanism means it works "
                 "for both men and women, and for people whose issue is desire, not just erection.",
         "benefits": ["Increases libido/desire (men &amp; women)", "Works centrally, not on blood flow",
                      "Taken as-needed before activity"],
         "protocol": "~1–2 mg SubQ about 45 minutes before intimacy. Not daily — as-needed. Start low.",
         "stack": "Provider TRT/HCG protocols for men.",
         "talk": "“It works on the desire centers in the brain, so it helps when the issue is wanting to, not "
                 "just the physical side — and it works for women too.”",
         "caution": "Nausea and facial flushing are dose-related — start low. Can transiently raise blood "
                    "pressure. Provider screens cardiovascular history."},
        {"name": "Kisspeptin-10", "skus": "YPB.266 (10 mg)",
         "what": "An upstream signaling peptide that stimulates GnRH release, driving LH and FSH — the body&rsquo;s "
                 "natural sex-hormone cascade. Researched for libido, fertility, and a more “natural-axis” "
                 "approach to hormone support.",
         "benefits": ["Stimulates natural sex-hormone production", "Libido", "Fertility signaling"],
         "protocol": "SubQ, provider-directed dosing.",
         "talk": "“This one works upstream — it tells the body to make its own sex hormones, a more natural-axis "
                 "approach.”",
         "caution": "Provider-directed; effects are signaling-based and individual."},
        {"name": "Melanotan 2", "skus": "YPB.270 (10 mg)",
         "what": "A melanocortin agonist best known for stimulating melanin (tanning) with minimal sun. It "
                 "shares PT-141&rsquo;s family, so it also carries a libido side-benefit. Popular for tanning, "
                 "especially in fair-skinned customers.",
         "benefits": ["Sunless/accelerated tanning", "Libido side-benefit", "Possible appetite reduction"],
         "protocol": "Low-dose SubQ loading then maintenance; provider-directed.",
         "talk": "“The tanning peptide — builds a tan with less sun, and some people notice a libido bump too.”",
         "caution": "Can darken moles/freckles and cause nausea. Advise a skin/mole check first. Not a "
                    "substitute for sun protection."},
     ]),
    ("COGNITIVE &amp; NEURO",
     "Focus, mood, anxiety, and neuroprotection. The Russian nootropics Semax and Selank lead this "
     "group — most are intranasal because they target the brain.",
     [
        {"name": "Semax", "skus": "YPB.229 (10 mg)",
         "what": "A nootropic peptide (an ACTH fragment) that boosts focus, mental energy, and learning by "
                 "raising BDNF (brain-derived neurotrophic factor) and modulating neurotransmitters. Also "
                 "studied for neuroprotection and stroke recovery. Usually intranasal.",
         "benefits": ["Focus &amp; mental clarity", "Raises BDNF (neuroplasticity)", "Neuroprotective"],
         "protocol": "Intranasal spray, mornings/daytime, as directed.",
         "stack": "Selank (the “focused but calm” daytime pair).",
         "talk": "“The focus-and-clarity nasal spray — like a clean mental boost, and it supports brain health "
                 "long-term.”",
         "caution": "Well-tolerated; intranasal."},
        {"name": "Selank", "skus": "YPB.228 (10 mg)",
         "what": "An anxiolytic nootropic (derived from a natural immune peptide, tuftsin). It reduces anxiety "
                 "and stabilizes mood <i>without</i> sedation or dependence — calm and clear rather than "
                 "drowsy. Intranasal.",
         "benefits": ["Reduces anxiety", "Calm focus, no sedation", "Non-habit-forming"],
         "protocol": "Intranasal spray as needed for calm focus.",
         "stack": "Semax.",
         "talk": "“The calm nasal spray — takes the edge off anxiety without making you tired or foggy.”",
         "caution": "Well-tolerated; intranasal."},
        {"name": "SS-31 (Elamipretide)", "skus": "YPB.245/246 (10/50 mg)",
         "what": "A mitochondria-targeted peptide that protects the cell&rsquo;s energy factories from oxidative "
                 "damage, restoring cellular energy. Researched for fatigue, neuro/cardiac health, and aging — "
                 "wherever poor mitochondrial function shows up as low energy or brain fog.",
         "benefits": ["Mitochondrial protection", "Cellular energy", "Anti-fatigue / anti-aging"],
         "protocol": "SubQ daily in cycles, provider-directed.",
         "stack": "NAD+, MOTS-c (mitochondrial/longevity).",
         "talk": "“It protects and recharges your cells&rsquo; energy factories — for people running on empty or with "
                 "brain fog.”",
         "caution": "Provider-directed; cyclical."},
        {"name": "Pinealon", "skus": "YPB.273 (20 mg)",
         "what": "A short peptide bioregulator that targets brain/neuronal tissue — researched for cognitive "
                 "function, neuroprotection, and circadian/sleep regulation. Part of the “bioregulator” "
                 "longevity family.",
         "benefits": ["Cognitive support", "Neuroprotection", "Circadian/sleep support"],
         "protocol": "Short SubQ cycles (e.g., 10–20 days), provider-directed.",
         "talk": "“A brain-targeted bioregulator — run in short cycles for cognition and sleep rhythm.”",
         "caution": "Cyclical; provider-directed."},
     ]),
    ("ANTI-AGING &amp; LONGEVITY",
     "The longevity stack — cellular energy, DNA/telomere maintenance, and clearing aged cells. NAD+ and "
     "Epitalon are the cornerstones; FOXO4-DRI is the advanced senolytic.",
     [
        {"name": "NAD+", "skus": "YPB.223/224 (500/1000 mg)",
         "what": "NAD+ is a coenzyme in every cell, essential for energy production and DNA repair — and it "
                 "declines with age. Supplementing supports cellular energy, repair, metabolism, and mental "
                 "clarity. The cornerstone longevity molecule.",
         "benefits": ["Cellular energy", "DNA repair", "Mental clarity", "Metabolic support"],
         "protocol": "SubQ — titrate dose slowly; injecting too fast causes flushing/discomfort. Often "
                     "smaller daily or larger weekly dosing.",
         "stack": "Glutathione, MOTS-c, Epitalon, GH stacks.",
         "talk": "“The foundational anti-aging molecule — it powers your cells and repairs DNA. Go slow with "
                 "the dose; rushing it just causes flushing.”",
         "caution": "Inject slowly — fast dosing causes a wave of flushing/chest tightness (harmless but "
                    "uncomfortable)."},
        {"name": "Epitalon (Epithalon)", "skus": "YPB.232/253/254 (5/10/50 mg)",
         "what": "A peptide bioregulator of the pineal gland that has been shown to activate telomerase "
                 "(the enzyme that maintains telomeres, the protective caps on DNA). Researched for longevity, "
                 "sleep, and circadian regulation. Run in short cycles a few times a year.",
         "benefits": ["Telomere/telomerase support", "Better sleep &amp; circadian rhythm", "Longevity / anti-aging"],
         "protocol": "Short SubQ cycle (e.g., 10–20 days), repeated 2–4&times;/year.",
         "stack": "NAD+, MOTS-c.",
         "talk": "“The telomere peptide — run as a short cycle a few times a year for longevity and better sleep.”",
         "caution": "Cyclical, not continuous; provider-directed."},
        {"name": "MOTS-c", "skus": "YPB.227/271 (10/40 mg)",
         "what": "A mitochondrial-derived peptide that acts like an “exercise mimetic” — improving insulin "
                 "sensitivity, fat metabolism, and endurance by signaling through metabolic pathways. Bridges "
                 "longevity and performance/weight goals.",
         "benefits": ["Metabolic health / insulin sensitivity", "Endurance (exercise-mimetic)", "Fat metabolism"],
         "protocol": "SubQ several times weekly in cycles; provider-directed.",
         "stack": "NAD+, SS-31, weight/performance protocols.",
         "talk": "“A mitochondrial peptide that mimics some benefits of exercise — metabolism and endurance.”",
         "caution": "Cyclical; provider-directed."},
        {"name": "FOXO4-DRI", "skus": "YPB.255 (10 mg)",
         "what": "An advanced <b>senolytic</b> — it selectively triggers the death of senescent (“zombie”) "
                 "cells that accumulate with age and drive inflammation. Used in short, infrequent cycles. "
                 "One of the most cutting-edge longevity research peptides.",
         "benefits": ["Clears senescent cells", "Reduces age-related inflammation", "Cutting-edge longevity"],
         "protocol": "Short, infrequent cycles; advanced, provider-directed.",
         "talk": "“The &lsquo;zombie-cell&rsquo; clearer — it removes worn-out cells that drive aging. Very cutting-edge, "
                 "used in short cycles.”",
         "caution": "Advanced/experimental; provider-directed only; infrequent cycling."},
        {"name": "PNC-27", "skus": "YPB.275 (10 mg)",
         "what": "A research peptide studied for its ability to selectively target cancer-cell membranes "
                 "(via an HDM-2/p53 mechanism). <b>Strictly research-use</b> — staff should not make any "
                 "therapeutic or anticancer claims; route all such questions to the provider.",
         "benefits": ["Research compound (oncology research context)"],
         "protocol": "Research-use; provider-directed only.",
         "talk": "“This is a research peptide. I can&rsquo;t make any medical claims about it — the provider is the "
                 "right person for any questions here.”",
         "caution": "Make NO therapeutic/anticancer claims. Research-use only. Always route to provider."},
     ]),
    ("SLEEP, RECOVERY &amp; NEURO-SUPPORT",
     "Deep sleep, nervous-system recovery, and nerve/inflammation support — the peptides that help the "
     "body repair when it&rsquo;s at rest.",
     [
        {"name": "DSIP (Delta Sleep-Inducing Peptide)", "skus": "YPB.230/252 (15/5 mg)",
         "what": "A naturally occurring peptide that promotes delta-wave (deep) sleep, helps regulate the "
                 "sleep-wake cycle, and reduces stress. Because deep sleep is when the body recovers and "
                 "releases GH, it&rsquo;s a recovery peptide as much as a sleep aid.",
         "benefits": ["Deeper sleep", "Stress reduction", "Supports nighttime GH/recovery"],
         "protocol": "Low dose SubQ before bed.",
         "stack": "GH stack (Sermorelin/CJC/Ipamorelin), Epitalon.",
         "talk": "“For deep, restorative sleep — and since recovery happens during sleep, it helps you bounce "
                 "back too.”",
         "caution": "Timing matters (before bed); individual response varies."},
        {"name": "VIP (VIP10)", "skus": "YPB.281 (10 mg)",
         "what": "Vasoactive Intestinal Peptide — a signaling molecule with broad anti-inflammatory and "
                 "immune-regulating roles. Researched for chronic inflammatory conditions (including mold/CIRS "
                 "protocols) and gut/respiratory health. Usually intranasal.",
         "benefits": ["Anti-inflammatory", "Immune regulation", "Used in CIRS/chronic-inflammation protocols"],
         "protocol": "Intranasal, provider-directed (often after other CIRS steps).",
         "talk": "“An anti-inflammatory signaling peptide — used in chronic-inflammation and mold-illness "
                 "protocols, usually under provider guidance.”",
         "caution": "Can transiently affect blood pressure; provider-directed, often later-stage in a protocol."},
        {"name": "ARA-290 (Cibinetide)", "skus": "YPB.277 (10 mg)",
         "what": "A peptide derived from erythropoietin that targets the innate repair receptor — researched "
                 "for neuropathic pain, nerve repair, and reducing inflammation, without EPO&rsquo;s blood effects.",
         "benefits": ["Neuropathic pain relief", "Nerve repair", "Anti-inflammatory"],
         "protocol": "SubQ daily in cycles; provider-directed.",
         "talk": "“For nerve pain and nerve repair — it calms inflammation around nerves.”",
         "caution": "Provider-directed; cyclical."},
     ]),
    ("IMMUNE SUPPORT",
     "Immune modulation and thymic function — peptides that help balance and strengthen the immune "
     "system rather than just stimulate it.",
     [
        {"name": "Thymosin Alpha-1 (TA1)", "skus": "YPB.231 (10 mg)",
         "what": "A thymic peptide that modulates and strengthens the immune system — enhancing T-cell "
                 "function and balancing immune response. Used clinically worldwide for infections and immune "
                 "support. The headline immune peptide.",
         "benefits": ["Strengthens immune defense", "Balances/modulates immune response", "Supports recovery from illness"],
         "protocol": "SubQ, 1–2&times;/week or daily in acute settings; provider-directed.",
         "stack": "Thymalin, glutathione.",
         "talk": "“The immune-support peptide — it tunes up and balances your immune system, great for resilience "
                 "and recovering from being run-down.”",
         "caution": "Generally very safe; provider-directed in autoimmune contexts."},
        {"name": "Thymalin", "skus": "YPB.280 (10 mg)",
         "what": "A thymic peptide bioregulator that supports and restores thymus function (the thymus drives "
                 "T-cell immunity and shrinks with age). Run in short cycles for immune restoration and "
                 "anti-aging of the immune system.",
         "benefits": ["Restores thymic/immune function", "Immune anti-aging", "Cyclical"],
         "protocol": "Short SubQ cycles (e.g., 10 days), repeated; provider-directed.",
         "talk": "“Rejuvenates the thymus — the gland that runs your immune system and fades with age. Run in "
                 "short cycles.”",
         "caution": "Cyclical; provider-directed."},
        {"name": "KPV", "skus": "YPB.265 (10 mg)",
         "what": "A tripeptide fragment of alpha-MSH with potent anti-inflammatory action, especially in the "
                 "gut and skin. Used for inflammatory bowel issues, mast-cell/allergic inflammation, and as the "
                 "calming component in the KLOW skin blend.",
         "benefits": ["Anti-inflammatory (gut &amp; skin)", "Helps IBD/mast-cell issues", "Non-immunosuppressive"],
         "protocol": "Oral/SubQ depending on target; provider-directed.",
         "stack": "BPC-157 (gut), KLOW blend (skin).",
         "talk": "“A targeted anti-inflammatory — especially for gut and skin inflammation, without shutting "
                 "down the immune system.”",
         "caution": "Provider-directed; well-tolerated."},
     ]),
    ("BODY COMPOSITION &amp; HORMONE SUPPORT",
     "Muscle preservation/building and hormone-axis support — including the fertility and TRT-adjacent "
     "peptides that often come up in men&rsquo;s-health conversations.",
     [
        {"name": "HCG (Human Chorionic Gonadotropin)", "skus": "YPB.256 (10,000 iu)",
         "what": "Mimics LH to stimulate the testes (testosterone &amp; sperm) or support ovulation. In men&rsquo;s "
                 "health it&rsquo;s used alongside TRT to maintain natural testicular function and fertility. Also "
                 "appears in some medically-supervised weight protocols.",
         "benefits": ["Maintains testicular function on TRT", "Supports fertility", "Hormone-axis support"],
         "protocol": "IM/SubQ, provider-directed dosing (often 2–3&times;/week with TRT).",
         "stack": "Provider TRT protocols, HMG for fertility.",
         "talk": "“Often used with testosterone therapy to keep the body&rsquo;s own production and fertility going. "
                 "This is firmly a provider-managed protocol.”",
         "caution": "Hormone-axis drug — provider-directed only. Route all TRT/fertility questions to the provider."},
        {"name": "HMG (Human Menopausal Gonadotropin)", "skus": "YPB.258 (75 iu)",
         "what": "Provides FSH (and LH) activity to drive sperm production in men or follicle development in "
                 "women — a fertility-focused tool, often paired with HCG.",
         "benefits": ["Fertility support (FSH activity)", "Sperm/follicle stimulation"],
         "protocol": "IM/SubQ, provider-directed.",
         "stack": "HCG.",
         "talk": "“A fertility-support hormone — usually managed with HCG by the provider.”",
         "caution": "Fertility/hormone drug — provider-directed only."},
        {"name": "ACE-031", "skus": "YPB.249 (1 mg)",
         "what": "A myostatin/activin inhibitor (a decoy receptor). By blocking myostatin — the protein that "
                 "<i>limits</i> muscle growth — it&rsquo;s researched for increasing muscle mass and strength. "
                 "Advanced research compound.",
         "benefits": ["Increases muscle mass (myostatin inhibition)", "Strength", "Research compound"],
         "protocol": "Research-use; provider-directed.",
         "talk": "“A research compound that blocks the body&rsquo;s muscle-limiting signal — advanced, provider-only.”",
         "caution": "Research-grade; can affect blood vessels in studies; provider-directed only."},
        {"name": "AICAR", "skus": "YPB.250 (50 mg)",
         "what": "An AMPK activator — it switches on the cellular energy sensor that&rsquo;s normally triggered by "
                 "exercise, boosting fat oxidation and endurance. An “exercise-mimetic” for body comp and "
                 "stamina.",
         "benefits": ["Fat oxidation", "Endurance", "Exercise-mimetic (AMPK)"],
         "protocol": "SubQ, provider-directed.",
         "stack": "SLU-PP-332, MOTS-c, weight protocols.",
         "talk": "“Flips on the same energy switch as exercise — supports fat burning and endurance.”",
         "caution": "Research compound; banned in sport; provider-directed."},
     ]),
    ("VITAMINS &amp; LIPOTROPICS",
     "Injectable nutrients and fat-metabolism blends — the gentle, broadly-appealing add-ons that pair "
     "with almost any goal and are easy first purchases.",
     [
        {"name": "B12 (Methylcobalamin)", "skus": "YPB.251 (10 ml)",
         "what": "Injectable vitamin B12 for energy, metabolism, nerve function, and red-blood-cell production. "
                 "A simple, popular energy add-on — especially for customers in a calorie deficit on a weight "
                 "protocol.",
         "benefits": ["Energy", "Metabolism support", "Nerve &amp; blood-cell health"],
         "protocol": "IM/SubQ, weekly or as directed.",
         "stack": "Weight-loss protocols, MIC blends, glutathione.",
         "talk": "“The classic energy shot — really popular alongside weight loss to keep energy up.”",
         "caution": "Very safe, water-soluble."},
        {"name": "Glutathione", "skus": "YPB.259/283 (1500/600 mg)",
         "what": "The body&rsquo;s master antioxidant. It detoxifies, protects cells from oxidative stress, supports "
                 "the liver and immune system, and is prized for skin brightening and an even tone. Bridges "
                 "skincare, longevity, and recovery.",
         "benefits": ["Master antioxidant / detox", "Skin brightening &amp; even tone", "Liver &amp; immune support"],
         "protocol": "IM/SubQ (or IV in clinic), 1–2&times;/week.",
         "stack": "Glutathione + B12 + NAD+ (the wellness trio); skincare stacks.",
         "talk": "“The master antioxidant — detox, immune support, and a real favorite for brighter, more even "
                 "skin.”",
         "caution": "Very well-tolerated."},
        {"name": "Lipotropic Blends (8X / 4X MIC)", "skus": "YPB.267/268",
         "what": "MIC injections — <b>M</b>ethionine, <b>I</b>nositol, <b>C</b>holine — plus B vitamins. These "
                 "lipotropic compounds help the liver mobilize and metabolize fat, and the B vitamins add "
                 "energy. The 8X blend is the more comprehensive version. A staple fat-loss support shot.",
         "benefits": ["Supports fat metabolism", "Energy (B vitamins)", "Pairs with any weight protocol"],
         "protocol": "IM/SubQ, typically weekly.",
         "stack": "GLP weight-loss drugs, B12, AOD-9604.",
         "talk": "“The fat-burner support shot — helps your liver process fat and gives an energy boost. Great "
                 "companion to a weight-loss plan.”",
         "caution": "Well-tolerated; an adjunct, not a standalone weight-loss solution."},
     ]),
    ("SUPPLIES &amp; THE BASICS",
     "What every customer needs to use peptides safely. The #1 follow-up question after “which peptide” "
     "is “how do I actually mix and inject it” — own this answer.",
     [
        {"name": "Bacteriostatic / Reconstitution Water", "skus": "YPB.225/226 (3/10 ml)",
         "what": "Sterile water with 0.9% benzyl alcohol that&rsquo;s used to reconstitute (dissolve) freeze-dried "
                 "peptides. The benzyl alcohol lets a vial be used over several weeks. Essential for nearly "
                 "every injectable peptide — never let a customer leave without it.",
         "benefits": ["Dissolves lyophilized peptide", "Multi-week vial use (bacteriostatic)", "Required for almost every injectable"],
         "protocol": "Add to the peptide vial to reconstitute; amount sets concentration (see Foundations).",
         "stack": "Every injectable peptide; pairs with the Peptide Supply Kit (syringes, alcohol wipes).",
         "talk": "“This is what you mix the peptide with. Don&rsquo;t forget it — and grab a supply kit for syringes "
                 "and wipes too.”",
         "caution": "Bacteriostatic water is for reconstitution, not for IV push of large volumes. Refrigerate "
                    "reconstituted vials."},
     ]),
]

STACKS = [
    ("Wolverine", "BPC-157 + TB-500", "Maximal injury &amp; tissue recovery"),
    ("GH Gold-Standard", "CJC-1295 (no DAC) + Ipamorelin", "GH optimization: muscle, fat loss, sleep"),
    ("GLOW", "GHK-Cu + BPC-157 + TB-500", "Skin glow + healing (inside-out beauty)"),
    ("KLOW", "GHK-Cu + KPV + BPC-157 + TB-500", "Reactive/inflamed skin + recovery"),
    ("CagriSema", "Cagrilintide + Semaglutide", "Enhanced appetite control / weight loss"),
    ("Lean-Cut", "GLP drug + Tesamorelin/GH stack", "Fat loss while preserving muscle"),
    ("Wellness Trio", "Glutathione + B12 + NAD+", "Energy, antioxidant, cellular health"),
    ("Focused-Calm", "Semax + Selank", "Daytime focus without anxiety"),
    ("Longevity Base", "NAD+ + Epitalon (cyclical)", "Cellular energy + telomere support"),
    ("Mito-Recovery", "MOTS-c + SS-31 + NAD+", "Mitochondrial energy &amp; endurance"),
]

FLASHCARDS = [
    ("Semaglutide", "GLP-1 weekly shot — appetite suppression, the gentle weight-loss entry."),
    ("Tirzepatide", "Dual GLP-1/GIP — stronger weight loss than semaglutide, weekly."),
    ("Retatrutide", "Triple GLP-1/GIP/glucagon — most powerful weight loss, provider-watched."),
    ("Cagrilintide", "Amylin analog — pairs with semaglutide (CagriSema) for extra appetite control."),
    ("AOD-9604", "GH fragment — fat burning without GH side effects; gentle, non-GLP."),
    ("BPC-157", "Healing peptide — tendons, gut, injuries; inject near the sore spot."),
    ("TB-500", "Systemic healing partner to BPC — flexibility, whole-body recovery."),
    ("Wolverine", "BPC + TB in one — complete recovery in a single shot."),
    ("GHK-Cu", "Copper peptide — collagen, skin healing, hair; serum or injection. Skincare star."),
    ("GLOW / KLOW", "Skin + healing blends; KLOW adds anti-inflammatory KPV for reactive skin."),
    ("Sermorelin", "Gentle GHRH — boosts your own GH; nightly, better sleep first."),
    ("CJC-1295 + Ipamorelin", "The gold-standard GH stack — clean GH pulse for muscle/recovery."),
    ("Tesamorelin", "GH peptide that targets deep belly (visceral) fat — FDA-approved for it."),
    ("IGF-1 LR3", "Advanced direct muscle-builder; provider-only, can drop blood sugar."),
    ("PT-141", "Libido peptide — works in the brain, men &amp; women, ~45 min before, as-needed."),
    ("Melanotan 2", "Tanning peptide with a libido side-benefit; watch moles."),
    ("Kisspeptin", "Upstream signal — tells the body to make its own sex hormones."),
    ("Semax", "Focus &amp; clarity nasal spray; raises BDNF."),
    ("Selank", "Calm/anti-anxiety nasal spray; no sedation."),
    ("DSIP", "Deep-sleep peptide; recovery happens during sleep."),
    ("NAD+", "Cornerstone longevity molecule — cellular energy &amp; DNA repair; inject SLOWLY."),
    ("Epitalon", "Telomere peptide — short cycles a few times a year; sleep + longevity."),
    ("MOTS-c", "Mitochondrial exercise-mimetic — metabolism &amp; endurance."),
    ("FOXO4-DRI", "Senolytic — clears &lsquo;zombie&rsquo; aged cells; advanced, cyclical."),
    ("Thymosin Alpha-1", "Headline immune peptide — strengthens &amp; balances immunity."),
    ("KPV", "Targeted anti-inflammatory for gut &amp; skin; non-immunosuppressive."),
    ("Glutathione", "Master antioxidant — detox, immune, skin brightening."),
    ("B12", "Energy shot — popular alongside weight loss."),
    ("MIC / Lipotropic", "Fat-metabolism + B-vitamin support shot; weight-loss companion."),
    ("Bac water", "What you mix peptides with; bacteriostatic = multi-week use. Never skip the upsell."),
]

QUIZ = [
    ("A customer wants to lose weight but is nervous about side effects. What&rsquo;s the gentle starting point and the #1 thing to pair it with?",
     "Semaglutide started low (0.25 mg/wk) with slow titration; pair with protein + resistance training to protect muscle."),
    ("What two numbers must you confirm before any dosing-in-units conversation?",
     "(1) mg of peptide in the vial and (2) mL of water added. Without both, a &lsquo;units&rsquo; number is meaningless."),
    ("Which peptide specifically targets deep visceral belly fat and is FDA-approved for that purpose?",
     "Tesamorelin."),
    ("What&rsquo;s the gold-standard growth-hormone stack and why is Ipamorelin the preferred secretagogue?",
     "CJC-1295 + Ipamorelin; Ipamorelin gives a clean GH pulse without raising cortisol, prolactin, or hunger."),
    ("Why does PT-141 work for people that traditional ED drugs don&rsquo;t help?",
     "It acts centrally on the brain&rsquo;s arousal/desire pathways, not on blood flow — and it works for women too."),
    ("A customer asks what to mix their peptide with and how long the vial lasts. What do you recommend?",
     "Bacteriostatic water (0.9% benzyl alcohol) — it lets the vial be used over several weeks; refrigerate after mixing. Add a supply kit."),
    ("Which peptide must you NEVER make therapeutic/anticancer claims about, and what do you do instead?",
     "PNC-27 — make no claims; route every question to the provider."),
    ("Name the skincare trio a beauty-focused customer might start with.",
     "GHK-Cu (collagen/glow) + Glutathione (brightening) + Snap-8 topical (fine lines); GLOW/KLOW blends are all-in-one options."),
    ("Why do you inject NAD+ slowly?",
     "Injecting too fast causes a wave of flushing/chest tightness — harmless but very uncomfortable."),
    ("Where do our peptides come from, and what&rsquo;s the name you must get right?",
     "Alpha BioMed (never &lsquo;Alpha Medical&rsquo;). General supplies come from McKesson."),
    ("A competitive athlete asks about BPC-157 for an injury. What must you flag?",
     "Many of these peptides (BPC, TB-500, GH secretagogues, AICAR) are on sport anti-doping banned lists — flag it proactively."),
    ("What&rsquo;s the difference between CJC-1295 with DAC and without DAC?",
     "With DAC = long-acting, steady GH, dosed ~weekly. Without DAC = short-acting clean pulses, daily, stacked with Ipamorelin."),
]

ROLEPLAYS = [
    {"title": "Roleplay 1 — Weight-loss inquiry (nervous first-timer)",
     "lines": [
        ("Customer", "I&rsquo;ve heard about these weight-loss shots but I&rsquo;m kind of scared of them."),
        ("Staff", "Totally understandable. Can I ask what your main goal is — steady fat loss, appetite control, both?"),
        ("Customer", "Mostly I just can&rsquo;t stop snacking at night."),
        ("Staff", "That&rsquo;s exactly what GLP-1 peptides like semaglutide help with — they make you feel full sooner and "
                  "longer, so the snacking urge fades. We start at the lowest dose and go up slowly, which keeps side "
                  "effects mild. The provider sets your exact schedule. The one tip I always give: keep your protein up "
                  "and do some resistance training, so you lose fat and not muscle."),
        ("Customer", "Okay, that&rsquo;s reassuring. What about energy, I&rsquo;m always tired when I diet?"),
        ("Staff", "A lot of people add a B12 shot for energy — it pairs really well. Let&rsquo;s get the provider to set "
                  "up your plan and we&rsquo;ll go from there."),
     ]},
    {"title": "Roleplay 2 — Skincare cross-sell",
     "lines": [
        ("Customer", "I&rsquo;m on the weight-loss program already. Do you have anything for skin? Mine&rsquo;s looking dull."),
        ("Staff", "Yes — skincare is one of our favorites. The star is GHK-Cu, a copper peptide that builds collagen and "
                  "gives skin that glow; it comes as a serum or an injection. A lot of people pair it with glutathione for "
                  "brightening and a more even tone."),
        ("Customer", "Is it complicated to use?"),
        ("Staff", "The serum is the easy on-ramp — just apply it daily. If you want the full effect we have the GLOW blend, "
                  "which combines the copper peptide with two healing peptides in one. I&rsquo;d let the provider confirm what "
                  "fits with your current plan."),
     ]},
    {"title": "Roleplay 3 — Recovery / athlete",
     "lines": [
        ("Customer", "I tweaked my shoulder lifting and it&rsquo;s not healing. Someone mentioned BPC-157?"),
        ("Staff", "Great option — BPC-157 is our go-to healing peptide for tendon and joint stuff, and people often inject "
                  "it near the area. For something stubborn we&rsquo;d often pair it with TB-500, or just use the Wolverine blend "
                  "that has both in one shot."),
        ("Customer", "I compete in powerlifting though."),
        ("Staff", "Really glad you mentioned that — several of these, including BPC-157, are on anti-doping banned lists. "
                  "I&rsquo;d want you to check your federation&rsquo;s rules before starting, and the provider can talk through "
                  "options with you."),
     ]},
    {"title": "Roleplay 4 — The &lsquo;how do I mix it&rsquo; question",
     "lines": [
        ("Customer", "I bought a peptide but I have no idea how to actually use it. It&rsquo;s just powder."),
        ("Staff", "No problem — that powder needs to be reconstituted, which just means mixing it with bacteriostatic "
                  "water. You add the water slowly down the side of the vial, let it dissolve on its own — don&rsquo;t shake "
                  "it — then keep it in the fridge."),
        ("Customer", "How much do I inject?"),
        ("Staff", "That depends on how many milligrams are in your vial and how much water you added — those two numbers "
                  "set the dose on the syringe. Let&rsquo;s confirm both and I&rsquo;ll have the provider verify your exact dose so "
                  "you&rsquo;re 100% sure. Do you have syringes and alcohol wipes? Our supply kit has everything."),
     ]},
]


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    doc = BaseDocTemplate(
        OUTPUT_PDF, pagesize=letter,
        leftMargin=0.75 * inch, rightMargin=0.75 * inch,
        topMargin=0.9 * inch, bottomMargin=0.75 * inch,
        title="ABXTAC Wellness Protocols — Staff Training Manual",
        author="Granite Mountain Health / ABXTAC",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin,
                  doc.width, doc.height, id="body")
    cover_frame = Frame(0, 0, letter[0], letter[1], id="cover",
                        leftPadding=0.9 * inch, rightPadding=0.9 * inch,
                        topPadding=0, bottomPadding=0)
    doc.addPageTemplates([
        PageTemplate(id="Cover", frames=[cover_frame], onPage=cover_page),
        PageTemplate(id="Content", frames=[frame], onPage=content_page),
    ])

    story = build_story()
    # Switch from Cover template to Content after the first page break.
    from reportlab.platypus import NextPageTemplate
    story.insert(0, NextPageTemplate("Content"))

    # Flatten any nested lists produced by block_flow.
    flat = []
    for item in story:
        if isinstance(item, list):
            flat.extend(item)
        else:
            flat.append(item)

    doc.build(flat)
    size = os.path.getsize(OUTPUT_PDF)
    print(f"✅ Generated {OUTPUT_PDF} ({size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
