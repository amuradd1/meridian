#!/usr/bin/env python3
"""
pdf_brief.py — Generates a clean, executive-level CPO Intelligence Brief PDF
using reportlab. Called by server.py endpoint /api/export-pdf.
"""
import io
import json
import os
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── Colors ──
NAVY = HexColor("#0c1220")
DARK_SURFACE = HexColor("#111827")
DARK_BORDER = HexColor("#1e2d40")
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
WHITE = white

# ── Styles ──
def get_styles():
    return {
        "title": ParagraphStyle(
            "Title", fontName="Helvetica-Bold", fontSize=14, leading=18,
            textColor=TEXT_PRIMARY, alignment=TA_LEFT, spaceAfter=2*mm,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle", fontName="Helvetica", fontSize=8, leading=10,
            textColor=TEXT_FAINT, alignment=TA_LEFT, spaceAfter=4*mm,
        ),
        "section_header": ParagraphStyle(
            "SectionHeader", fontName="Helvetica-Bold", fontSize=9, leading=12,
            textColor=ACCENT, alignment=TA_LEFT, spaceBefore=5*mm, spaceAfter=2*mm,
        ),
        "body": ParagraphStyle(
            "Body", fontName="Helvetica", fontSize=8.5, leading=12,
            textColor=TEXT_PRIMARY, alignment=TA_LEFT,
        ),
        "body_muted": ParagraphStyle(
            "BodyMuted", fontName="Helvetica", fontSize=7.5, leading=10,
            textColor=TEXT_MUTED, alignment=TA_LEFT,
        ),
        "bullet": ParagraphStyle(
            "Bullet", fontName="Helvetica", fontSize=8.5, leading=12.5,
            textColor=TEXT_PRIMARY, alignment=TA_LEFT, leftIndent=5*mm,
            bulletIndent=0, spaceBefore=1.5*mm, bulletFontName="Helvetica",
        ),
        "kpi_value": ParagraphStyle(
            "KPIValue", fontName="Helvetica-Bold", fontSize=11, leading=14,
            textColor=TEXT_PRIMARY, alignment=TA_CENTER,
        ),
        "kpi_label": ParagraphStyle(
            "KPILabel", fontName="Helvetica", fontSize=6, leading=8,
            textColor=TEXT_FAINT, alignment=TA_CENTER,
        ),
        "table_header": ParagraphStyle(
            "TableHeader", fontName="Helvetica-Bold", fontSize=7, leading=9,
            textColor=TEXT_FAINT, alignment=TA_LEFT,
        ),
        "table_cell": ParagraphStyle(
            "TableCell", fontName="Helvetica", fontSize=7.5, leading=10,
            textColor=TEXT_PRIMARY, alignment=TA_LEFT,
        ),
        "table_cell_bold": ParagraphStyle(
            "TableCellBold", fontName="Helvetica-Bold", fontSize=7.5, leading=10,
            textColor=TEXT_PRIMARY, alignment=TA_LEFT,
        ),
        "footer": ParagraphStyle(
            "Footer", fontName="Helvetica", fontSize=6, leading=8,
            textColor=TEXT_FAINT, alignment=TA_CENTER,
        ),
        "risk_high": ParagraphStyle(
            "RiskHigh", fontName="Helvetica-Bold", fontSize=7.5, leading=10,
            textColor=RED, alignment=TA_CENTER,
        ),
        "risk_medium": ParagraphStyle(
            "RiskMedium", fontName="Helvetica-Bold", fontSize=7.5, leading=10,
            textColor=AMBER, alignment=TA_CENTER,
        ),
        "risk_low": ParagraphStyle(
            "RiskLow", fontName="Helvetica-Bold", fontSize=7.5, leading=10,
            textColor=GREEN, alignment=TA_CENTER,
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

def risk_style(level, styles):
    l = (level or "").upper()
    if l in ("H", "HIGH"): return styles["risk_high"]
    if l in ("L", "LOW"): return styles["risk_low"]
    return styles["risk_medium"]


def generate_pdf(data: dict) -> bytes:
    """Generate a clean CPO intelligence brief PDF from data.json content."""
    buf = io.BytesIO()
    styles = get_styles()
    intel = data.get("intelligence", {})
    kpi = intel.get("kpi_summary", {})
    commodities = data.get("commodities", [])
    timestamp = data.get("timestamp", "")
    
    page_w, page_h = A4
    margin = 15*mm
    
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=margin, rightMargin=margin,
        topMargin=12*mm, bottomMargin=12*mm,
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
        Paragraph("Daily Geopolitical & Energy<br/>Procurement Intelligence Brief", styles["title"]),
        Paragraph(
            f'<font size="7" color="{TEXT_FAINT.hexval()}">{date_str}</font>'
            f'&nbsp;&nbsp;&nbsp;'
            f'<font size="8" color="{risk_label_color.hexval()}"><b>{overall_risk} RISK</b></font>',
            ParagraphStyle("TitleRight", fontName="Helvetica", fontSize=8, alignment=TA_RIGHT, leading=12)
        ),
    ]]
    title_table = Table(title_data, colWidths=[usable_w*0.65, usable_w*0.35])
    title_table.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "BOTTOM"),
        ("BOTTOMPADDING", (0,0), (-1,-1), 0),
    ]))
    story.append(title_table)
    story.append(Spacer(1, 1*mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER_GRAY, spaceAfter=3*mm))
    
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
    kpi_table = Table([kpi_row_values, kpi_row_labels], colWidths=[col_w]*6, rowHeights=[16, 10])
    kpi_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), LIGHT_GRAY),
        ("BOX", (0,0), (-1,-1), 0.5, BORDER_GRAY),
        ("INNERGRID", (0,0), (-1,-1), 0.5, BORDER_GRAY),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,0), 3),
        ("BOTTOMPADDING", (0,0), (-1,0), 1),
        ("TOPPADDING", (0,1), (-1,1), 1),
        ("BOTTOMPADDING", (0,1), (-1,1), 3),
    ]))
    story.append(kpi_table)
    
    # ── Executive Summary ──
    story.append(Paragraph("EXECUTIVE SUMMARY", styles["section_header"]))
    exec_summary = intel.get("executive_summary", [])
    if isinstance(exec_summary, list):
        for bullet in exec_summary[:5]:
            story.append(Paragraph(f"• {bullet}", styles["bullet"]))
    elif isinstance(exec_summary, str):
        story.append(Paragraph(exec_summary, styles["body"]))
    
    # ── Two-column: Energy Markets | Chokepoints ──
    story.append(Spacer(1, 3*mm))
    
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
            Paragraph(f'{c["price"]:.2f} <font size="6" color="{TEXT_FAINT.hexval()}">{c["unit"]}</font>', styles["table_cell"]),
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
        ("TOPPADDING", (0,0), (-1,-1), 2),
        ("BOTTOMPADDING", (0,0), (-1,-1), 2),
        ("LEFTPADDING", (0,0), (-1,-1), 3),
        ("RIGHTPADDING", (0,0), (-1,-1), 3),
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
        ("TOPPADDING", (0,0), (-1,-1), 2),
        ("BOTTOMPADDING", (0,0), (-1,-1), 2),
        ("LEFTPADDING", (0,0), (-1,-1), 3),
        ("RIGHTPADDING", (0,0), (-1,-1), 3),
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
        ("RIGHTPADDING", (0,0), (0,-1), 4*mm),
        ("LEFTPADDING", (1,0), (1,-1), 2*mm),
    ]))
    story.append(layout_table)
    
    # ── Container Freight Rates ──
    story.append(Paragraph("CONTAINER FREIGHT RATES", styles["section_header"]))
    freight_header = [
        Paragraph("<b>ROUTE</b>", styles["table_header"]),
        Paragraph("<b>20FT RATE</b>", styles["table_header"]),
        Paragraph("<b>7D CHANGE</b>", styles["table_header"]),
        Paragraph("<b>CONFLICT IMPACT</b>", styles["table_header"]),
    ]
    freight_rows = [freight_header]
    for fr in intel.get("container_freight_rates", []):
        chg = fr.get("change_7d", "")
        chg_color = RED if "+" in chg else (GREEN if "-" in chg else TEXT_MUTED)
        freight_rows.append([
            Paragraph(f'<b>{fr.get("route", "")}</b>', styles["table_cell_bold"]),
            Paragraph(fr.get("rate_20ft", "—"), styles["table_cell"]),
            Paragraph(f'<font color="{chg_color.hexval()}">{chg}</font>', styles["table_cell"]),
            Paragraph(fr.get("conflict_impact", "—"), styles["table_cell"]),
        ])
    
    freight_table = Table(freight_rows, colWidths=[usable_w*0.25, usable_w*0.13, usable_w*0.12, usable_w*0.50])
    freight_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), LIGHT_GRAY),
        ("LINEBELOW", (0,0), (-1,0), 0.5, BORDER_GRAY),
        ("LINEBELOW", (0,1), (-1,-1), 0.25, BORDER_GRAY),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("TOPPADDING", (0,0), (-1,-1), 2),
        ("BOTTOMPADDING", (0,0), (-1,-1), 2),
        ("LEFTPADDING", (0,0), (-1,-1), 3),
        ("RIGHTPADDING", (0,0), (-1,-1), 3),
    ]))
    story.append(freight_table)
    
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
        rbg = risk_bg(r)
        ec = risk_color(cat.get("energy_sensitivity", "M"))
        proc_rows.append([
            Paragraph(f'<b>{cat.get("name", "")}</b>', styles["table_cell_bold"]),
            Paragraph(f'<font color="{ec.hexval()}"><b>{cat.get("energy_sensitivity", "—")}</b></font>', styles["table_cell"]),
            Paragraph(f'<font color="{rc.hexval()}"><b>{r}</b></font>', styles["table_cell"]),
            Paragraph(cat.get("suggested_mitigation", "—"), styles["body_muted"]),
        ])
    
    proc_col_widths = [usable_w*0.22, usable_w*0.07, usable_w*0.06, usable_w*0.65]
    proc_table = Table(proc_rows, colWidths=proc_col_widths)
    
    # Build row-level risk background colors
    proc_style_cmds = [
        ("BACKGROUND", (0,0), (-1,0), LIGHT_GRAY),
        ("LINEBELOW", (0,0), (-1,0), 0.5, BORDER_GRAY),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("TOPPADDING", (0,0), (-1,-1), 2.5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 2.5),
        ("LEFTPADDING", (0,0), (-1,-1), 3),
        ("RIGHTPADDING", (0,0), (-1,-1), 3),
    ]
    for i, cat in enumerate(intel.get("procurement_categories", [])):
        row_idx = i + 1  # skip header
        bg = risk_bg(cat.get("risk", "M"))
        proc_style_cmds.append(("BACKGROUND", (0, row_idx), (-1, row_idx), bg))
        proc_style_cmds.append(("LINEBELOW", (0, row_idx), (-1, row_idx), 0.25, BORDER_GRAY))
    
    proc_table.setStyle(TableStyle(proc_style_cmds))
    story.append(proc_table)
    
    # ── COGS Outlook ──
    cogs = intel.get("cogs_outlook", "")
    if cogs:
        story.append(Spacer(1, 3*mm))
        cogs_data = [[
            Paragraph("<b>COGS OUTLOOK</b>", ParagraphStyle(
                "COGSLabel", fontName="Helvetica-Bold", fontSize=7.5, leading=10,
                textColor=ACCENT, alignment=TA_LEFT,
            )),
            Paragraph(cogs, styles["body_muted"]),
        ]]
        cogs_table = Table(cogs_data, colWidths=[usable_w*0.18, usable_w*0.82])
        cogs_table.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,-1), LIGHT_GRAY),
            ("BOX", (0,0), (-1,-1), 0.5, BORDER_GRAY),
            ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
            ("TOPPADDING", (0,0), (-1,-1), 4),
            ("BOTTOMPADDING", (0,0), (-1,-1), 4),
            ("LEFTPADDING", (0,0), (-1,-1), 5),
            ("RIGHTPADDING", (0,0), (-1,-1), 5),
        ]))
        story.append(cogs_table)
    
    # ── Footer ──
    story.append(Spacer(1, 4*mm))
    story.append(HRFlowable(width="100%", thickness=0.3, color=BORDER_GRAY, spaceAfter=2*mm))
    gen_time = ""
    if timestamp:
        try:
            dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            gen_time = dt.strftime("%d %b %Y %H:%M UTC")
        except Exception:
            gen_time = timestamp
    story.append(Paragraph(
        f"Sources: Yahoo Finance, Google News, Claude AI (Anthropic), Natural Earth &nbsp;&nbsp;|&nbsp;&nbsp; Generated {gen_time}",
        styles["footer"]
    ))
    
    doc.build(story)
    buf.seek(0)
    return buf.read()
