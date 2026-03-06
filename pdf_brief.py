#!/usr/bin/env python3
"""
pdf_brief.py — Generates a clean, executive-level CPO Intelligence Brief PDF
using reportlab. Fits on a single A4 page. Called by server.py /api/export-pdf.
"""
import io
import json
import os
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable,
)

# ── Colors ──
TEXT_PRIMARY = HexColor("#1a1a2e")
TEXT_MUTED = HexColor("#4a5568")
TEXT_FAINT = HexColor("#718096")
ACCENT = HexColor("#0369a1")
RED = HexColor("#dc2626")
AMBER = HexColor("#d97706")
GREEN = HexColor("#16a34a")
RED_BG = HexColor("#fef2f2")
AMBER_BG = HexColor("#fffbeb")
GREEN_BG = HexColor("#f0fdf4")
LIGHT_GRAY = HexColor("#f7fafc")
BORDER_GRAY = HexColor("#e2e8f0")


def get_styles():
    return {
        "title": ParagraphStyle(
            "Title", fontName="Helvetica-Bold", fontSize=12, leading=15,
            textColor=TEXT_PRIMARY, alignment=TA_LEFT, spaceAfter=1*mm,
        ),
        "section_header": ParagraphStyle(
            "SectionHeader", fontName="Helvetica-Bold", fontSize=7.5, leading=10,
            textColor=ACCENT, alignment=TA_LEFT, spaceBefore=3*mm, spaceAfter=1.5*mm,
        ),
        "body_muted": ParagraphStyle(
            "BodyMuted", fontName="Helvetica", fontSize=6.5, leading=8.5,
            textColor=TEXT_MUTED, alignment=TA_LEFT,
        ),
        "bullet": ParagraphStyle(
            "Bullet", fontName="Helvetica", fontSize=7, leading=9.5,
            textColor=TEXT_PRIMARY, alignment=TA_LEFT, leftIndent=4*mm,
            bulletIndent=0, spaceBefore=0.8*mm, bulletFontName="Helvetica",
        ),
        "kpi_value": ParagraphStyle(
            "KPIValue", fontName="Helvetica-Bold", fontSize=9, leading=11,
            textColor=TEXT_PRIMARY, alignment=TA_CENTER,
        ),
        "kpi_label": ParagraphStyle(
            "KPILabel", fontName="Helvetica", fontSize=5, leading=7,
            textColor=TEXT_FAINT, alignment=TA_CENTER,
        ),
        "table_header": ParagraphStyle(
            "TableHeader", fontName="Helvetica-Bold", fontSize=5.5, leading=7,
            textColor=TEXT_FAINT, alignment=TA_LEFT,
        ),
        "table_cell": ParagraphStyle(
            "TableCell", fontName="Helvetica", fontSize=6.5, leading=8.5,
            textColor=TEXT_PRIMARY, alignment=TA_LEFT,
        ),
        "table_cell_bold": ParagraphStyle(
            "TableCellBold", fontName="Helvetica-Bold", fontSize=6.5, leading=8.5,
            textColor=TEXT_PRIMARY, alignment=TA_LEFT,
        ),
        "footer": ParagraphStyle(
            "Footer", fontName="Helvetica", fontSize=5.5, leading=7,
            textColor=TEXT_FAINT, alignment=TA_CENTER,
        ),
    }


def risk_color(level):
    l = (level or "").upper()
    if l in ("H", "HIGH"): return RED
    if l in ("L", "LOW"): return GREEN
    return AMBER

def risk_bg(level):
    l = (level or "").upper()
    if l in ("H", "HIGH"): return RED_BG
    if l in ("L", "LOW"): return GREEN_BG
    return AMBER_BG


def generate_pdf(data: dict) -> bytes:
    """Generate a single-page A4 CPO intelligence brief PDF."""
    buf = io.BytesIO()
    styles = get_styles()
    intel = data.get("intelligence", {})
    kpi = intel.get("kpi_summary", {})
    commodities = data.get("commodities", [])
    timestamp = data.get("timestamp", "")

    page_w, page_h = A4
    margin = 12*mm

    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=margin, rightMargin=margin,
        topMargin=10*mm, bottomMargin=8*mm,
        title="Daily Geopolitical & Energy Procurement Intelligence Brief",
        author="Perplexity Computer",
    )

    story = []
    usable_w = page_w - 2*margin

    # ── Title Row ──
    date_str = ""
    if timestamp:
        try:
            dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            date_str = dt.strftime("%d %B %Y")
        except Exception:
            date_str = datetime.now().strftime("%d %B %Y")
    else:
        date_str = datetime.now().strftime("%d %B %Y")

    overall_risk = (intel.get("overall_risk", "MEDIUM")).upper()
    risk_label_color = risk_color(overall_risk)

    title_data = [[
        Paragraph("Daily Geopolitical & Energy Procurement Intelligence Brief", styles["title"]),
        Paragraph(
            f'<font size="6" color="{TEXT_FAINT.hexval()}">{date_str}</font>'
            f'&nbsp;&nbsp;'
            f'<font size="7" color="{risk_label_color.hexval()}"><b>{overall_risk} RISK</b></font>',
            ParagraphStyle("TitleRight", fontName="Helvetica", fontSize=7, alignment=TA_RIGHT, leading=10)
        ),
    ]]
    title_table = Table(title_data, colWidths=[usable_w*0.65, usable_w*0.35])
    title_table.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "BOTTOM"),
        ("BOTTOMPADDING", (0,0), (-1,-1), 0),
    ]))
    story.append(title_table)
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER_GRAY, spaceBefore=1*mm, spaceAfter=2*mm))

    # ── Disclaimer ──
    story.append(Paragraph(
        '<font color="#718096"><b>Disclaimer:</b> Macro-level analysis only — does not reflect individual supplier agreements or contract terms. Contact your category team for supplier-specific guidance.</font>',
        ParagraphStyle("Disclaimer", fontName="Helvetica", fontSize=5.5, leading=7.5, textColor=TEXT_FAINT, alignment=TA_LEFT, spaceBefore=0, spaceAfter=1.5*mm)
    ))

    # ── KPI Strip ──
    energy_trend = kpi.get("energy_cost_trend", "STABLE")
    energy_dir = energy_trend.split("—")[0].split(" - ")[0].split(" – ")[0].strip()

    kpi_items = [
        ("COGS Pressure", kpi.get("overall_cogs_pressure", "STABLE")),
        ("Energy Trend", energy_dir),
        ("Disruption", kpi.get("supply_chain_disruption_level", "MODERATE")),
        ("Ship Delay", f"{kpi.get('avg_shipping_delay_days', 0):.0f}d" if kpi.get("avg_shipping_delay_days") is not None else "—"),
        ("Chokepoints", f"{kpi.get('active_chokepoint_disruptions', 0)} / 4"),
        ("High-Risk Cat.", f"{kpi.get('categories_at_high_risk', 0)} / 8"),
    ]

    kpi_row_values = []
    kpi_row_labels = []
    for label, value in kpi_items:
        kpi_row_values.append(Paragraph(f'<b>{value}</b>', styles["kpi_value"]))
        kpi_row_labels.append(Paragraph(label.upper(), styles["kpi_label"]))

    col_w = usable_w / 6
    kpi_table = Table([kpi_row_values, kpi_row_labels], colWidths=[col_w]*6, rowHeights=[13, 8])
    kpi_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), LIGHT_GRAY),
        ("BOX", (0,0), (-1,-1), 0.5, BORDER_GRAY),
        ("INNERGRID", (0,0), (-1,-1), 0.5, BORDER_GRAY),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,0), 2),
        ("BOTTOMPADDING", (0,0), (-1,0), 0),
        ("TOPPADDING", (0,1), (-1,1), 0),
        ("BOTTOMPADDING", (0,1), (-1,1), 2),
    ]))
    story.append(kpi_table)

    # ── Executive Summary ──
    story.append(Paragraph("EXECUTIVE SUMMARY", styles["section_header"]))
    exec_summary = intel.get("executive_summary", [])
    if isinstance(exec_summary, list):
        for bullet in exec_summary[:5]:
            story.append(Paragraph(f"• {bullet}", styles["bullet"]))
    elif isinstance(exec_summary, str):
        story.append(Paragraph(exec_summary, styles["body_muted"]))

    # ── Two-column: Energy Markets | Chokepoints ──
    story.append(Spacer(1, 1.5*mm))

    # Energy Markets table
    energy_header = [
        Paragraph("<b>COMMODITY</b>", styles["table_header"]),
        Paragraph("<b>PRICE</b>", styles["table_header"]),
        Paragraph("<b>24H</b>", styles["table_header"]),
        Paragraph("<b>7D</b>", styles["table_header"]),
    ]
    energy_rows = [energy_header]
    for c in commodities[:6]:
        c24 = c.get("change_24h", 0)
        c7 = c.get("change_7d", 0)
        col24 = GREEN if c24 >= 0 else RED
        col7 = GREEN if c7 >= 0 else RED
        sign24 = "+" if c24 > 0 else ""
        sign7 = "+" if c7 > 0 else ""
        energy_rows.append([
            Paragraph(f'<b>{c["name"]}</b>', styles["table_cell_bold"]),
            Paragraph(f'{c["price"]:.2f} <font size="5" color="{TEXT_FAINT.hexval()}">{c["unit"]}</font>', styles["table_cell"]),
            Paragraph(f'<font color="{col24.hexval()}">{sign24}{c24:.1f}%</font>', styles["table_cell"]),
            Paragraph(f'<font color="{col7.hexval()}">{sign7}{c7:.1f}%</font>', styles["table_cell"]),
        ])

    energy_col_widths = [usable_w*0.20, usable_w*0.13, usable_w*0.08, usable_w*0.08]
    energy_table = Table(energy_rows, colWidths=energy_col_widths)
    energy_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), LIGHT_GRAY),
        ("LINEBELOW", (0,0), (-1,0), 0.5, BORDER_GRAY),
        ("LINEBELOW", (0,1), (-1,-1), 0.25, BORDER_GRAY),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,-1), 1.5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 1.5),
        ("LEFTPADDING", (0,0), (-1,-1), 2),
        ("RIGHTPADDING", (0,0), (-1,-1), 2),
    ]))

    # Chokepoints table
    choke_header = [
        Paragraph("<b>CHOKEPOINT</b>", styles["table_header"]),
        Paragraph("<b>STATUS</b>", styles["table_header"]),
        Paragraph("<b>DELAY</b>", styles["table_header"]),
    ]
    choke_rows = [choke_header]
    for cp in intel.get("chokepoint_status", []):
        status = cp.get("status", "OPEN")
        sc = risk_color({"OPEN":"L","RESTRICTED":"M","CLOSED":"H"}.get(status, "M"))
        delay_str = f'+{cp.get("delay_hours", 0)}h' if cp.get("delay_hours", 0) > 0 else "—"
        choke_rows.append([
            Paragraph(cp.get("name", ""), styles["table_cell_bold"]),
            Paragraph(f'<font color="{sc.hexval()}"><b>{status}</b></font>', styles["table_cell"]),
            Paragraph(delay_str, styles["table_cell"]),
        ])

    choke_col_widths = [usable_w*0.25, usable_w*0.12, usable_w*0.08]
    choke_table = Table(choke_rows, colWidths=choke_col_widths)
    choke_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), LIGHT_GRAY),
        ("LINEBELOW", (0,0), (-1,0), 0.5, BORDER_GRAY),
        ("LINEBELOW", (0,1), (-1,-1), 0.25, BORDER_GRAY),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,-1), 1.5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 1.5),
        ("LEFTPADDING", (0,0), (-1,-1), 2),
        ("RIGHTPADDING", (0,0), (-1,-1), 2),
    ]))

    # Side by side layout
    two_col_header = [[
        Paragraph("ENERGY MARKETS", styles["section_header"]),
        Paragraph("CHOKEPOINT STATUS", styles["section_header"]),
    ]]
    two_col_data = [[energy_table, choke_table]]

    layout_table = Table(
        two_col_header + two_col_data,
        colWidths=[usable_w*0.52, usable_w*0.48]
    )
    layout_table.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 0),
        ("RIGHTPADDING", (0,0), (0,-1), 3*mm),
        ("LEFTPADDING", (1,0), (1,-1), 2*mm),
        ("TOPPADDING", (0,0), (-1,0), 0),
        ("BOTTOMPADDING", (0,0), (-1,0), 0),
    ]))
    story.append(layout_table)

    # ── Procurement Category Exposure Matrix ──
    story.append(Paragraph("PROCUREMENT CATEGORY EXPOSURE", styles["section_header"]))
    proc_header = [
        Paragraph("<b>CATEGORY</b>", styles["table_header"]),
        Paragraph("<b>ENERGY</b>", styles["table_header"]),
        Paragraph("<b>RISK</b>", styles["table_header"]),
        Paragraph("<b>SUGGESTED MITIGATION</b>", styles["table_header"]),
    ]
    proc_rows = [proc_header]
    for cat in intel.get("procurement_categories", []):
        r = cat.get("risk", "M")
        rc = risk_color(r)
        ec = risk_color(cat.get("energy_sensitivity", "M"))
        # Truncate mitigation to keep it compact
        mitigation = cat.get("suggested_mitigation", "—")
        if len(mitigation) > 120:
            mitigation = mitigation[:117] + "..."
        proc_rows.append([
            Paragraph(f'<b>{cat.get("name", "")}</b>', styles["table_cell_bold"]),
            Paragraph(f'<font color="{ec.hexval()}"><b>{cat.get("energy_sensitivity", "—")}</b></font>', styles["table_cell"]),
            Paragraph(f'<font color="{rc.hexval()}"><b>{r}</b></font>', styles["table_cell"]),
            Paragraph(mitigation, styles["body_muted"]),
        ])

    proc_col_widths = [usable_w*0.20, usable_w*0.06, usable_w*0.05, usable_w*0.69]
    proc_table = Table(proc_rows, colWidths=proc_col_widths)

    proc_style_cmds = [
        ("BACKGROUND", (0,0), (-1,0), LIGHT_GRAY),
        ("LINEBELOW", (0,0), (-1,0), 0.5, BORDER_GRAY),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("TOPPADDING", (0,0), (-1,-1), 1.5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 1.5),
        ("LEFTPADDING", (0,0), (-1,-1), 2),
        ("RIGHTPADDING", (0,0), (-1,-1), 2),
    ]
    for i, cat in enumerate(intel.get("procurement_categories", [])):
        row_idx = i + 1
        bg = risk_bg(cat.get("risk", "M"))
        proc_style_cmds.append(("BACKGROUND", (0, row_idx), (-1, row_idx), bg))
        proc_style_cmds.append(("LINEBELOW", (0, row_idx), (-1, row_idx), 0.25, BORDER_GRAY))

    proc_table.setStyle(TableStyle(proc_style_cmds))
    story.append(proc_table)

    # ── Analyst Sentiment (compact) ──
    sentiment = intel.get("analyst_sentiment", {})
    if sentiment:
        story.append(Spacer(1, 1.5*mm))
        overall_s = (sentiment.get("overall", "NEUTRAL")).upper()
        sc = risk_color({"BEARISH": "H", "BULLISH": "L"}.get(overall_s, "M"))
        sentiment_text = f'<font color="{sc.hexval()}"><b>{overall_s}</b></font>'
        parts = []
        for key, label in [("energy_outlook", "Energy"), ("supply_chain_outlook", "Supply Chain"), ("procurement_outlook", "Procurement")]:
            val = sentiment.get(key, "")
            if val:
                parts.append(f"<b>{label}:</b> {val}")
        outlook_text = " | ".join(parts) if parts else "No outlook available."

        sent_data = [[
            Paragraph(f"<b>ANALYST SENTIMENT</b> &nbsp; {sentiment_text}",
                ParagraphStyle("SentLabel", fontName="Helvetica-Bold", fontSize=6.5, leading=8.5, textColor=ACCENT)),
            Paragraph(outlook_text, styles["body_muted"]),
        ]]
        sent_table = Table(sent_data, colWidths=[usable_w*0.22, usable_w*0.78])
        sent_table.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,-1), LIGHT_GRAY),
            ("BOX", (0,0), (-1,-1), 0.5, BORDER_GRAY),
            ("VALIGN", (0,0), (-1,-1), "TOP"),
            ("TOPPADDING", (0,0), (-1,-1), 3),
            ("BOTTOMPADDING", (0,0), (-1,-1), 3),
            ("LEFTPADDING", (0,0), (-1,-1), 4),
            ("RIGHTPADDING", (0,0), (-1,-1), 4),
        ]))
        story.append(sent_table)

    # ── COGS Outlook ──
    cogs = intel.get("cogs_outlook", "")
    if cogs:
        story.append(Spacer(1, 1.5*mm))
        cogs_data = [[
            Paragraph("<b>COGS OUTLOOK</b>", ParagraphStyle(
                "COGSLabel", fontName="Helvetica-Bold", fontSize=6.5, leading=8.5, textColor=ACCENT)),
            Paragraph(cogs, styles["body_muted"]),
        ]]
        cogs_table = Table(cogs_data, colWidths=[usable_w*0.15, usable_w*0.85])
        cogs_table.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,-1), LIGHT_GRAY),
            ("BOX", (0,0), (-1,-1), 0.5, BORDER_GRAY),
            ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
            ("TOPPADDING", (0,0), (-1,-1), 3),
            ("BOTTOMPADDING", (0,0), (-1,-1), 3),
            ("LEFTPADDING", (0,0), (-1,-1), 4),
            ("RIGHTPADDING", (0,0), (-1,-1), 4),
        ]))
        story.append(cogs_table)

    # ── Footer ──
    story.append(Spacer(1, 2*mm))
    story.append(HRFlowable(width="100%", thickness=0.3, color=BORDER_GRAY, spaceAfter=1*mm))
    gen_time = ""
    if timestamp:
        try:
            dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            gen_time = dt.strftime("%d %b %Y %H:%M UTC")
        except Exception:
            gen_time = timestamp
    story.append(Paragraph(
        f"Sources: Yahoo Finance, Investing.com (JKM), Google News, Claude AI (Anthropic), Natural Earth &nbsp;|&nbsp; Generated {gen_time}",
        styles["footer"]
    ))

    doc.build(story)
    buf.seek(0)
    return buf.read()
