#!/usr/bin/env python3
"""Generate a detailed SOC architecture PDF for NER + RAG workflows."""

from pathlib import Path

from reportlab.graphics.shapes import Circle, Drawing, Line, Polygon, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


def draw_arrow(drawing: Drawing, x1: float, y1: float, x2: float, y2: float, color):
    """Draw a simple arrow between two points."""
    drawing.add(Line(x1, y1, x2, y2, strokeColor=color, strokeWidth=1.5))
    if y2 < y1:
        drawing.add(Polygon([x2, y2, x2 - 4, y2 + 8, x2 + 4, y2 + 8], fillColor=color, strokeColor=color))
    elif y2 > y1:
        drawing.add(Polygon([x2, y2, x2 - 4, y2 - 8, x2 + 4, y2 - 8], fillColor=color, strokeColor=color))
    elif x2 > x1:
        drawing.add(Polygon([x2, y2, x2 - 8, y2 - 4, x2 - 8, y2 + 4], fillColor=color, strokeColor=color))
    else:
        drawing.add(Polygon([x2, y2, x2 + 8, y2 - 4, x2 + 8, y2 + 4], fillColor=color, strokeColor=color))


def build_main_pipeline() -> Drawing:
    steps = [
        "1. Alert Triggered",
        "2. NER Extraction",
        "3. Enrichment Checks",
        "4. RAG Retrieval",
        "5. Prompt Construction",
        "6. LLM Reasoning",
        "7. Playbook Generation",
        "8. Analyst Feedback",
    ]
    subtitles = [
        "SIEM/Wazuh emits raw event text",
        "Extract IP, host, protocol, event type",
        "Threat feeds, incidents, ATT&CK mapping",
        "Fetch top-K intel and similar incidents",
        "Merge alert + context + objective",
        "Assess severity and containment actions",
        "Generate runbook and SOAR tasks",
        "Store outcomes for future retrieval",
    ]

    width = 16.8 * cm
    box_w = 14.5 * cm
    box_h = 1.45 * cm
    gap = 0.55 * cm
    height = len(steps) * (box_h + gap) + 0.6 * cm
    start_x = (width - box_w) / 2
    y = height - box_h - 0.3 * cm

    drawing = Drawing(width, height)
    for idx, (title, subtitle) in enumerate(zip(steps, subtitles)):
        fill = colors.HexColor("#F8FAFC") if idx % 2 == 0 else colors.HexColor("#EEF2FF")
        drawing.add(Rect(start_x, y, box_w, box_h, rx=8, ry=8, fillColor=fill, strokeColor=colors.HexColor("#1F2937")))
        drawing.add(String(start_x + 10, y + box_h - 15, title, fontName="Helvetica-Bold", fontSize=10))
        drawing.add(String(start_x + 10, y + 8, subtitle, fontName="Helvetica", fontSize=8.5))
        if idx < len(steps) - 1:
            draw_arrow(
                drawing,
                width / 2,
                y - 2,
                width / 2,
                y - gap + 2,
                colors.HexColor("#1F2937"),
            )
        y -= box_h + gap
    return drawing


def build_ner_rag_diagram() -> Drawing:
    width = 16.8 * cm
    height = 8.8 * cm
    drawing = Drawing(width, height)

    box_style = dict(rx=8, ry=8, strokeColor=colors.HexColor("#0F172A"), fillColor=colors.HexColor("#EFF6FF"))
    db_style = dict(rx=8, ry=8, strokeColor=colors.HexColor("#0F172A"), fillColor=colors.HexColor("#FEF3C7"))

    drawing.add(Rect(10, 220, 130, 46, **box_style))
    drawing.add(String(20, 246, "Raw Security Logs", fontName="Helvetica-Bold", fontSize=9))
    drawing.add(String(20, 232, "SIEM, host logs, auth logs", fontName="Helvetica", fontSize=8))

    drawing.add(Rect(170, 220, 120, 46, **box_style))
    drawing.add(String(180, 246, "NER Parser", fontName="Helvetica-Bold", fontSize=9))
    drawing.add(String(180, 232, "IP, host, user, protocol", fontName="Helvetica", fontSize=8))

    drawing.add(Rect(320, 220, 140, 46, **box_style))
    drawing.add(String(330, 246, "Enrichment Layer", fontName="Helvetica-Bold", fontSize=9))
    drawing.add(String(330, 232, "Reputation + ATT&CK + history", fontName="Helvetica", fontSize=8))

    drawing.add(Rect(170, 145, 120, 46, **db_style))
    drawing.add(String(180, 171, "Embedding Model", fontName="Helvetica-Bold", fontSize=9))
    drawing.add(String(180, 157, "Alert + entity vector", fontName="Helvetica", fontSize=8))

    drawing.add(Rect(320, 145, 140, 46, **db_style))
    drawing.add(String(330, 171, "Vector Database", fontName="Helvetica-Bold", fontSize=9))
    drawing.add(String(330, 157, "Top-K docs and incidents", fontName="Helvetica", fontSize=8))

    drawing.add(
        Rect(
            170,
            70,
            290,
            52,
            rx=8,
            ry=8,
            strokeColor=colors.HexColor("#0F172A"),
            fillColor=colors.HexColor("#DCFCE7"),
        )
    )
    drawing.add(String(180, 101, "LLM Decision Engine", fontName="Helvetica-Bold", fontSize=9))
    drawing.add(String(180, 87, "Severity, confidence, recommended actions, SOAR payload", fontName="Helvetica", fontSize=8))

    drawing.add(
        Rect(
            10,
            70,
            130,
            52,
            rx=8,
            ry=8,
            strokeColor=colors.HexColor("#0F172A"),
            fillColor=colors.HexColor("#FEE2E2"),
        )
    )
    drawing.add(String(20, 101, "Analyst Review", fontName="Helvetica-Bold", fontSize=9))
    drawing.add(String(20, 87, "Approve, reject, tune", fontName="Helvetica", fontSize=8))

    draw_arrow(drawing, 140, 243, 170, 243, colors.HexColor("#0F172A"))
    draw_arrow(drawing, 290, 243, 320, 243, colors.HexColor("#0F172A"))
    draw_arrow(drawing, 230, 220, 230, 191, colors.HexColor("#0F172A"))
    draw_arrow(drawing, 390, 220, 390, 191, colors.HexColor("#0F172A"))
    draw_arrow(drawing, 290, 168, 320, 168, colors.HexColor("#0F172A"))
    draw_arrow(drawing, 390, 145, 390, 122, colors.HexColor("#0F172A"))
    draw_arrow(drawing, 230, 145, 230, 122, colors.HexColor("#0F172A"))
    draw_arrow(drawing, 140, 96, 170, 96, colors.HexColor("#0F172A"))
    draw_arrow(drawing, 320, 96, 140, 96, colors.HexColor("#B91C1C"))

    drawing.add(Circle(305, 96, 2, fillColor=colors.HexColor("#0F172A"), strokeColor=colors.HexColor("#0F172A")))
    drawing.add(String(327, 109, "Feedback loop", fontName="Helvetica", fontSize=7.5, fillColor=colors.HexColor("#B91C1C")))

    return drawing


def add_page_chrome(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#6B7280"))
    canvas.setFont("Helvetica", 8.5)
    canvas.drawString(doc.leftMargin, 16, "SOC Architecture Guide: NER + RAG for Alert Triage")
    canvas.drawRightString(A4[0] - doc.rightMargin, 16, f"Page {canvas.getPageNumber()}")
    canvas.restoreState()


def build_pdf(output_path: Path):
    output_path.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        leftMargin=1.7 * cm,
        rightMargin=1.7 * cm,
        topMargin=1.8 * cm,
        bottomMargin=1.8 * cm,
        title="SOC Architecture Guide: NER and RAG",
        author="Codex",
    )

    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "TitleLarge",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=24,
        leading=30,
        textColor=colors.HexColor("#0F172A"),
    )
    subtitle = ParagraphStyle(
        "Subtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=11,
        leading=16,
        textColor=colors.HexColor("#374151"),
    )
    h1 = ParagraphStyle(
        "H1",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=16,
        leading=22,
        textColor=colors.HexColor("#111827"),
        spaceAfter=8,
    )
    h2 = ParagraphStyle(
        "H2",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=12.5,
        leading=17,
        textColor=colors.HexColor("#0F172A"),
        spaceAfter=6,
    )
    body = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#111827"),
        spaceAfter=7,
    )
    small = ParagraphStyle(
        "Small",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=8.8,
        leading=12.2,
        textColor=colors.HexColor("#374151"),
    )

    story = []

    story.append(Paragraph("SOC Architecture: NER and RAG in Production Workflows", title))
    story.append(Spacer(1, 10))
    story.append(
        Paragraph(
            "This guide explains how a Security Operations Center can combine Named Entity Recognition (NER) and "
            "Retrieval-Augmented Generation (RAG) to reduce mean time to respond (MTTR), improve analyst consistency, "
            "and scale triage quality under high alert volume.",
            subtitle,
        )
    )
    story.append(Spacer(1, 14))

    outcome_box = Table(
        [
            [Paragraph("<b>Target Outcomes</b>", body)],
            [
                Paragraph(
                    "- Faster triage with structured evidence<br/>"
                    "- Better precision through threat context retrieval<br/>"
                    "- Explainable recommendations with linked sources<br/>"
                    "- Continuous improvement from analyst feedback",
                    body,
                )
            ],
        ],
        colWidths=[16.8 * cm],
    )
    outcome_box.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ECFEFF")),
                ("BOX", (0, 0), (-1, -1), 1.2, colors.HexColor("#0E7490")),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(outcome_box)
    story.append(Spacer(1, 16))

    story.append(Paragraph("<b>Reference Alert</b>", h2))
    alert_box = Table(
        [[Paragraph("Multiple failed SSH logins from 185.220.101.45 to server prod-01", body)]],
        colWidths=[16.8 * cm],
    )
    alert_box.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#334155")),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(alert_box)
    story.append(Spacer(1, 20))
    story.append(
        Paragraph(
            "Architecture principle: use NER to create clean machine-readable indicators, then use RAG to inject relevant "
            "intelligence and historical context before the LLM decides on severity and action.",
            body,
        )
    )

    story.append(PageBreak())
    story.append(Paragraph("End-to-End Flow", h1))
    story.append(
        Paragraph(
            "The pipeline below shows how an alert moves from raw text to operational response. "
            "Each stage creates data that is consumed by the next stage, which is why extraction quality and retrieval quality "
            "strongly impact final recommendations.",
            body,
        )
    )
    story.append(Spacer(1, 4))
    story.append(build_main_pipeline())
    story.append(Spacer(1, 10))
    story.append(
        Paragraph(
            "<b>Why this works:</b> NER reduces ambiguity first; RAG then narrows the context to high-signal evidence. "
            "The LLM reasons over evidence instead of guessing from the raw log alone.",
            body,
        )
    )

    story.append(PageBreak())
    story.append(Paragraph("Architecture Interaction: NER + RAG Components", h1))
    story.append(
        Paragraph(
            "This component map separates extraction, retrieval, and decision layers. Keeping these boundaries clear makes "
            "the system easier to test and tune.",
            body,
        )
    )
    story.append(Spacer(1, 10))
    story.append(build_ner_rag_diagram())
    story.append(Spacer(1, 10))

    story.append(Paragraph("Step-by-Step Processing Model", h2))
    details_rows = [
        [
            "1. Alert Triggered",
            "Raw SIEM event",
            "Normalize event source, timezone, and rule metadata",
            "Canonical alert object",
        ],
        [
            "2. NER Extraction",
            "Canonical alert",
            "Entity parser + regex fallbacks + confidence scores",
            "Structured indicators",
        ],
        [
            "3. Enrichment",
            "Indicators",
            "Query threat feeds, ATT&CK, internal case index",
            "Context package",
        ],
        [
            "4. RAG Retrieval",
            "Alert + context package",
            "Embed and retrieve top-K relevant records",
            "Retrieved evidence set",
        ],
        [
            "5-6. Reasoning",
            "Evidence set + task objective",
            "Prompt assembly and LLM decision scoring",
            "Severity + actions + rationale",
        ],
        [
            "7-8. Action + Feedback",
            "Decision payload",
            "SOAR orchestration + analyst verification",
            "Runbook execution + learning data",
        ],
    ]
    details_data = [["Stage", "Input", "Core Processing", "Output Artifact"]]
    for row in details_rows:
        details_data.append([Paragraph(cell, small) for cell in row])

    details_table = Table(
        details_data,
        colWidths=[2.8 * cm, 3.4 * cm, 5.5 * cm, 5.1 * cm],
        repeatRows=1,
    )
    details_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E293B")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 9),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#FFFFFF"), colors.HexColor("#F8FAFC")]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(details_table)

    story.append(PageBreak())
    story.append(Paragraph("Deep Dive: NER Layer Design", h1))
    story.append(
        Paragraph(
            "NER in SOC is not generic language tagging. It is a detection-oriented parser that extracts indicators needed for "
            "correlation, enrichment, and response automation. The parser should support confidence values and provenance metadata "
            "for each extracted field.",
            body,
        )
    )

    story.append(Paragraph("Entity Schema Example", h2))
    schema_table = Table(
        [
            ["Field", "Example", "Validation", "Why it matters"],
            ["source_ip", "185.220.101.45", "IPv4 format + reputation lookup", "Drives threat intelligence and blocking"],
            ["target_host", "prod-01", "CMDB or hostname pattern", "Links event to asset criticality"],
            ["protocol", "SSH", "Known protocol list", "Helps classify attack path"],
            ["event_type", "failed_login", "Mapped from rule taxonomy", "Controls response playbook selection"],
            ["username", "root", "Known account or new account", "Supports account abuse detection"],
            ["count_5m", "47", "Numeric threshold check", "Improves confidence in brute-force hypothesis"],
        ],
        colWidths=[2.8 * cm, 3.4 * cm, 4.7 * cm, 5.9 * cm],
        repeatRows=1,
    )
    schema_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#065F46")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.4),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#A7F3D0")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#ECFDF5"), colors.HexColor("#F0FDF4")]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(schema_table)
    story.append(Spacer(1, 10))

    story.append(Paragraph("NER Engineering Recommendations", h2))
    ner_points = [
        "Use a hybrid parser: deterministic patterns for high precision fields (IP, ports) and model-based extraction for flexible fields (command intent, actor role).",
        "Store extraction confidence and parser version per field. This supports model drift analysis and rollback.",
        "Attach alert-time context (time window counts, asset criticality, geolocation) before retrieval to improve search quality.",
        "Track extraction errors explicitly. Failed extraction should not silently continue to response generation.",
    ]
    for p in ner_points:
        story.append(Paragraph(f"- {p}", body))

    story.append(PageBreak())
    story.append(Paragraph("Deep Dive: RAG Retrieval and Prompting", h1))
    story.append(
        Paragraph(
            "RAG quality depends on retrieval discipline. Do not retrieve generic documents. Retrieve only records that can help "
            "answer the current response task with evidence quality, recency, and source trust considered explicitly.",
            body,
        )
    )

    story.append(Paragraph("Recommended Retrieval Inputs", h2))
    retrieval_inputs = Table(
        [
            ["Input", "Description", "Priority"],
            ["Alert text", "Raw event narrative and rule metadata", "High"],
            ["NER entities", "IP, host, account, protocol, event type", "High"],
            ["Enrichment bundle", "Reputation, ATT&CK techniques, internal incidents", "High"],
            ["Operational context", "Business criticality, maintenance windows", "Medium"],
            ["Analyst notes", "Prior decision rationales for similar events", "Medium"],
        ],
        colWidths=[3.1 * cm, 10.1 * cm, 3.6 * cm],
        repeatRows=1,
    )
    retrieval_inputs.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#7C2D12")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.8),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#FDBA74")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#FFF7ED"), colors.HexColor("#FFEDD5")]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.append(retrieval_inputs)
    story.append(Spacer(1, 10))

    story.append(Paragraph("Prompt Assembly Template", h2))
    prompt_template = (
        "<b>System objective:</b> classify severity and generate minimal safe response plan.<br/>"
        "<b>Alert:</b> {canonical_alert}<br/>"
        "<b>Entities:</b> {ner_entities_with_confidence}<br/>"
        "<b>Retrieved evidence:</b> {top_k_docs_with_source_and_score}<br/>"
        "<b>Constraints:</b> include only actions supported by evidence. "
        "If confidence is low, request analyst confirmation."
    )
    template_box = Table([[Paragraph(prompt_template, small)]], colWidths=[16.8 * cm])
    template_box.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                ("BOX", (0, 0), (-1, -1), 1.0, colors.HexColor("#334155")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(template_box)
    story.append(Spacer(1, 8))
    story.append(Paragraph("Guardrail: force citation of retrieved sources in every recommendation.", body))

    story.append(PageBreak())
    story.append(Paragraph("Playbook Generation and Execution", h1))
    story.append(
        Paragraph(
            "When severity and confidence pass a threshold, the response payload is turned into orchestrated actions. "
            "Automation must remain reversible and observable.",
            body,
        )
    )

    playbook_table = Table(
        [
            ["Playbook Step", "Automated Action", "Validation Gate"],
            ["Contain source IP", "Create temporary block on perimeter firewall", "Check allow-list and false positive risk"],
            ["Investigate account activity", "Pull auth logs for affected accounts", "Confirm account ownership and MFA status"],
            ["Host-level triage", "Query EDR for related process/network events", "Verify host criticality before isolation"],
            ["Detection tuning", "Adjust rule thresholds and suppression windows", "Backtest against last 30 days of alerts"],
            ["Closure update", "Write timeline and rationale to ticket", "Analyst approval required for final closure"],
        ],
        colWidths=[4.6 * cm, 6.8 * cm, 5.4 * cm],
        repeatRows=1,
    )
    playbook_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#312E81")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.6),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#C7D2FE")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#EEF2FF"), colors.HexColor("#E0E7FF")]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.append(playbook_table)
    story.append(Spacer(1, 10))

    story.append(Paragraph("Analyst Feedback Loop Implementation", h2))
    feedback_items = [
        "Store analyst disposition, modified steps, and rationale in a searchable memory store.",
        "Feed that memory back into retrieval so similar future alerts start with proven workflows.",
        "Measure recommendation acceptance rate by alert type to detect drift in model quality.",
        "Review rejected recommendations weekly and update extraction or retrieval logic first, then prompts.",
    ]
    for item in feedback_items:
        story.append(Paragraph(f"- {item}", body))

    story.append(PageBreak())
    story.append(Paragraph("Operational Metrics and Rollout Plan", h1))
    story.append(
        Paragraph(
            "To prove value, track performance by phase and by incident class. The first production target is reliability, "
            "not maximum automation depth.",
            body,
        )
    )

    metric_table = Table(
        [
            ["Metric", "Definition", "Target Direction"],
            ["MTTR", "Median time from alert creation to analyst-approved response", "Decrease"],
            ["Triage Precision", "Percent of high-severity recommendations accepted by analysts", "Increase"],
            ["Extraction Coverage", "Percent of alerts with all mandatory entities extracted", "Increase"],
            ["Retrieval Relevance", "Analyst-rated usefulness of top-K retrieved evidence", "Increase"],
            ["Automation Safety", "Percent of automated actions rolled back due to false positives", "Decrease"],
        ],
        colWidths=[4.0 * cm, 9.0 * cm, 3.8 * cm],
        repeatRows=1,
    )
    metric_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#9CA3AF")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#FFFFFF"), colors.HexColor("#F3F4F6")]),
                ("FONTSIZE", (0, 0), (-1, -1), 8.8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.append(metric_table)
    story.append(Spacer(1, 12))

    story.append(Paragraph("Phased Deployment", h2))
    phases = [
        "<b>Phase 1:</b> extraction and enrichment in shadow mode, no automated action.",
        "<b>Phase 2:</b> retrieval and recommendation generation, analyst as mandatory approver.",
        "<b>Phase 3:</b> controlled automation for low-risk/high-confidence scenarios.",
        "<b>Phase 4:</b> continuous tuning with weekly model and playbook quality review.",
    ]
    for ph in phases:
        story.append(Paragraph(f"- {ph}", body))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "This architecture turns unstructured security data into evidence-based decision support. "
            "NER contributes structure, RAG contributes context, and analysts remain the quality control layer.",
            body,
        )
    )

    doc.build(story, onFirstPage=add_page_chrome, onLaterPages=add_page_chrome)


def main():
    out = Path("output/pdf/soc-architecture-ner-rag-guide.pdf")
    build_pdf(out)
    print(f"Generated: {out}")


if __name__ == "__main__":
    main()
