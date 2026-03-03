#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(text.replace("\n", "<br/>"), style)


def build_pdf(output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        leftMargin=1.7 * cm,
        rightMargin=1.7 * cm,
        topMargin=1.6 * cm,
        bottomMargin=1.6 * cm,
        title="Rajeev Ranjan - Resume",
        author="Rajeev Ranjan",
    )

    styles = getSampleStyleSheet()
    name_style = ParagraphStyle(
        "Name",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=26,
        textColor=colors.HexColor("#0F172A"),
        spaceAfter=2,
    )
    headline_style = ParagraphStyle(
        "Headline",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10.5,
        leading=14,
        textColor=colors.HexColor("#334155"),
    )
    contact_style = ParagraphStyle(
        "Contact",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#334155"),
        alignment=2,  # right
    )
    section_style = ParagraphStyle(
        "Section",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#0F172A"),
        spaceBefore=10,
        spaceAfter=6,
    )
    body_style = ParagraphStyle(
        "Body",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#111827"),
    )
    small_muted = ParagraphStyle(
        "SmallMuted",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9.2,
        leading=12,
        textColor=colors.HexColor("#475569"),
    )
    bullet_style = ParagraphStyle(
        "Bullet",
        parent=body_style,
        leftIndent=12,
        firstLineIndent=-12,
        spaceBefore=1,
        spaceAfter=1,
    )

    story: list[object] = []

    header_left = [
        _p("Rajeev Ranjan", name_style),
        _p("<b>Founder</b> | <b>Full Stack Developer</b> | Product-minded builder", headline_style),
    ]
    header_right = [
        _p("24F1002713@ds.study.iitm.ac.in", contact_style),
        _p("Chennai, Tamil Nadu, India", contact_style),
    ]

    content_width = doc.width
    header = Table([[header_left, header_right]], colWidths=[content_width * 0.62, content_width * 0.38])
    header.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    story.append(header)
    story.append(Spacer(1, 6))

    story.append(_p("Summary", section_style))
    story.append(
        _p(
            "Founder and full stack developer focused on building trusted, community-first platforms. "
            "Experienced in shipping MVPs, designing product workflows, and delivering end-to-end features "
            "across frontend, backend APIs, and payments/automation.",
            body_style,
        )
    )

    story.append(_p("Experience", section_style))

    story.append(_p("<b>Founder</b> - BattleF Inc. (Self-employed)", body_style))
    story.append(_p("Oct 2024 - Present | Chennai, India (On-site)", small_muted))
    story.extend(
        [
            _p("- Building BattleF, a discovery-first platform for competitive esports tournaments.", bullet_style),
            _p(
                "- Designing a centralized tournament marketplace for grassroots, collegiate, and creator-led events.",
                bullet_style,
            ),
            _p(
                "- Reducing organizer friction through automation and secure payment workflows.",
                bullet_style,
            ),
            _p(
                "- Building around player/team identity, competitive history, and progression to drive repeat engagement.",
                bullet_style,
            ),
        ]
    )
    story.append(Spacer(1, 6))

    story.append(_p("<b>Full Stack Developer</b> - Originn (Part-time)", body_style))
    story.append(_p("Aug 2025 - Present | Chennai, India (Hybrid)", small_muted))
    story.extend(
        [
            _p(
                "- Building a Validation Engine product to help startups reach real market validation (MVP stage).",
                bullet_style,
            ),
            _p(
                "- Developing end-to-end features across web UI, backend services, and database workflows.",
                bullet_style,
            ),
            _p(
                "- Integrating trust-focused payment and order flows, including escrow-style processes and status tracking.",
                bullet_style,
            ),
            _p(
                "- Shipping production-ready code with API contracts, logging, and deployment-friendly packaging.",
                bullet_style,
            ),
        ]
    )

    story.append(_p("Skills", section_style))
    skills_table = Table(
        [
            [
                _p("<b>Languages</b>", small_muted),
                _p("Python, JavaScript, TypeScript, SQL", body_style),
            ],
            [
                _p("<b>Frontend</b>", small_muted),
                _p("React, Next.js, HTML, CSS, Tailwind CSS", body_style),
            ],
            [
                _p("<b>Backend</b>", small_muted),
                _p("FastAPI, Django/DRF, Node.js/Express, REST APIs, Webhooks", body_style),
            ],
            [
                _p("<b>Data and Infra</b>", small_muted),
                _p("PostgreSQL, Redis, Docker, AWS, CI/CD, Git", body_style),
            ],
            [
                _p("<b>Product</b>", small_muted),
                _p("Product strategy, roadmapping, user workflows, stakeholder communication", body_style),
            ],
        ],
        colWidths=[3.2 * cm, 13.2 * cm],
        hAlign="LEFT",
    )
    skills_table.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.append(skills_table)

    story.append(_p("Education", section_style))
    story.append(_p("<b>Indian Institute of Technology Madras (IITM)</b>", body_style))
    story.append(_p("BS Degree - Diploma Level | CGPA: 8.1", small_muted))

    doc.build(story)


def main() -> None:
    build_pdf(Path("output/pdf/rajeev_ranjan_resume.pdf"))


if __name__ == "__main__":
    main()
