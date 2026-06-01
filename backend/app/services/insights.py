from __future__ import annotations

from io import BytesIO
from datetime import datetime, timezone
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


_REPORT_FONT = "FinTrackReport"
_REPORT_FONT_BOLD = "FinTrackReportBold"


def _ensure_report_fonts() -> tuple[str, str]:
    for font_name, font_path in (
        (_REPORT_FONT, "/Library/Fonts/Arial Unicode.ttf"),
        (_REPORT_FONT, "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
    ):
        try:
            pdfmetrics.getFont(font_name)
            bold_name = f"{font_name}Bold"
            pdfmetrics.getFont(bold_name)
            return font_name, bold_name
        except KeyError:
            try:
                pdfmetrics.registerFont(TTFont(font_name, font_path))
                pdfmetrics.registerFont(TTFont(bold_name, font_path))
                return font_name, bold_name
            except Exception:
                continue
    return "Helvetica", "Helvetica-Bold"


def _escape_pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:.2f}".rstrip("0").rstrip(".")
    return str(value)


def _human_label(value: str) -> str:
    return str(value or "").replace("_", " ").replace("-", " ").strip().title()


def _friendly_timestamp(value: Any) -> str:
    text = _cell(value)
    if not text:
        return ""
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        local_dt = parsed.astimezone()
        return local_dt.strftime("%d %b %Y, %I:%M %p")
    except Exception:
        return text


def _looks_like_datetime(value: Any) -> bool:
    text = _cell(value)
    return "T" in text or text.endswith("Z")


def _friendly_date(value: Any) -> str:
    text = _cell(value)
    if not text:
        return ""
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.strftime("%d %b %Y")
    except Exception:
        return text


def _format_metric_value(label: str, value: Any) -> str:
    text = _cell(value)
    if not text:
        return ""
    if _looks_like_datetime(text):
        return _friendly_timestamp(text)
    return text


def _format_report_cell(column_label: str, value: Any) -> str:
    text = _cell(value)
    if not text:
        return "—"
    lowered = column_label.lower()
    if _looks_like_datetime(text) or "date" in lowered or lowered in {"raised", "cleared"}:
        return _friendly_date(text)
    return text


def _friendly_filters_summary(value: Any) -> str:
    text = _cell(value)
    if not text or text == "No active filters":
        return "No filters applied"
    parts = []
    for chunk in text.split(" · "):
        if ":" in chunk:
            key, raw = chunk.split(":", 1)
            parts.append(f"{_human_label(key)}: {raw.strip()}")
        else:
            parts.append(chunk.strip())
    return "  •  ".join(parts)


def _report_meta_lines(meta: dict[str, Any], rows: list[list[Any]], columns: list[str]) -> list[tuple[str, str]]:
    lines = [
        ("Report", _cell(meta.get("page_label") or meta.get("page") or "")),
        ("Dataset", _cell(meta.get("source_label") or meta.get("source") or "")),
        ("Rows", _cell(meta.get("rows") or len(rows))),
        ("Columns", _cell(len(columns))),
        ("Generated", _friendly_timestamp(meta.get("generated_at"))),
        ("Filters", _friendly_filters_summary(meta.get("filters_summary"))),
    ]
    return [(label, value) for label, value in lines if value]


def build_excel_xml(title: str, columns: list[str], rows: list[list[Any]], meta: dict[str, Any] | None = None) -> bytes:
    meta = meta or {}

    def esc(text: str) -> str:
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )

    meta_rows = []
    for key, value in meta.items():
        meta_rows.append(
            f'<Row><Cell ss:StyleID="meta"><Data ss:Type="String">{esc(str(key))}</Data></Cell>'
            f'<Cell ss:StyleID="meta"><Data ss:Type="String">{esc(str(value))}</Data></Cell></Row>'
        )
    col_row = "".join(
        f'<Cell ss:StyleID="header"><Data ss:Type="String">{esc(col)}</Data></Cell>' for col in columns
    )
    body_rows = []
    for row in rows:
        cells = "".join(
            f'<Cell><Data ss:Type="String">{esc(_cell(cell))}</Data></Cell>' for cell in row
        )
        body_rows.append(f"<Row>{cells}</Row>")

    xml = f"""<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#E8EEF9" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="meta">
   <Font ss:Italic="1"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Report">
  <Table>
   <Row><Cell ss:MergeAcross="{max(len(columns) - 1, 0)}" ss:StyleID="header"><Data ss:Type="String">{esc(title)}</Data></Cell></Row>
   {''.join(meta_rows)}
   <Row/>
   <Row>{col_row}</Row>
   {''.join(body_rows)}
  </Table>
 </Worksheet>
</Workbook>"""
    return xml.encode("utf-8")


def build_simple_pdf(title: str, columns: list[str], rows: list[list[Any]], meta: dict[str, Any] | None = None) -> bytes:
    meta = meta or {}
    base_font, bold_font = _ensure_report_fonts()
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "FinTrackTitle",
        parent=styles["Heading1"],
        fontName=bold_font,
        fontSize=22,
        leading=26,
        textColor=colors.HexColor("#101B33"),
        spaceAfter=6,
    )
    subtitle_style = ParagraphStyle(
        "FinTrackSubtitle",
        parent=styles["BodyText"],
        fontName=base_font,
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#5B6B86"),
        spaceAfter=8,
    )
    label_style = ParagraphStyle(
        "FinTrackLabel",
        parent=styles["BodyText"],
        fontName=bold_font,
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#7082A1"),
    )
    value_style = ParagraphStyle(
        "FinTrackValue",
        parent=styles["BodyText"],
        fontName=base_font,
        fontSize=10,
        leading=12,
        textColor=colors.HexColor("#16233B"),
    )
    card_label_style = ParagraphStyle(
        "FinTrackCardLabel",
        parent=styles["BodyText"],
        fontName=bold_font,
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#7082A1"),
    )
    card_value_style = ParagraphStyle(
        "FinTrackCardValue",
        parent=styles["BodyText"],
        fontName=bold_font,
        fontSize=14,
        leading=17,
        textColor=colors.HexColor("#101B33"),
    )
    table_header_style = ParagraphStyle(
        "FinTrackTableHeader",
        parent=styles["BodyText"],
        fontName=bold_font,
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#2746F5"),
    )
    table_cell_style = ParagraphStyle(
        "FinTrackTableCell",
        parent=styles["BodyText"],
        fontName=base_font,
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#16233B"),
    )

    story: list[Any] = []
    page_label = _cell(meta.get("page_label") or meta.get("page") or title)
    source_label = _cell(meta.get("source_label") or meta.get("source") or "")
    summary_cards = meta.get("summary_cards") if isinstance(meta.get("summary_cards"), list) else []

    story.append(Paragraph(title, title_style))
    subtitle_bits = [page_label]
    if source_label:
        subtitle_bits.append(source_label)
    subtitle_bits.append(f"{len(rows):,} rows")
    subtitle_bits.append(f"{len(columns):,} columns")
    story.append(Paragraph(" • ".join(subtitle_bits), subtitle_style))

    report_meta = _report_meta_lines(meta, rows, columns)
    if report_meta:
        meta_cells = []
        for label, value in report_meta:
            meta_cells.append(
                [
                    Paragraph(label.upper(), label_style),
                    Paragraph(value, value_style),
                ]
            )
        meta_table = Table(meta_cells, colWidths=[30 * mm, 96 * mm], hAlign="LEFT")
        meta_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F6F8FC")),
                    ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#D8E0EE")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E5EBF6")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        story.append(meta_table)
        story.append(Spacer(1, 8))

    if summary_cards:
        top_cards = summary_cards[:4]
        card_rows = []
        row = []
        for card in top_cards:
            cell = Table(
                [[Paragraph(_cell(card.get("label") or ""), card_label_style)], [Paragraph(_format_metric_value(_cell(card.get("label")), card.get("value")), card_value_style)]],
                colWidths=[43 * mm],
            )
            cell.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EEF3FF")),
                        ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#D7E1FF")),
                        ("LEFTPADDING", (0, 0), (-1, -1), 10),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                        ("TOPPADDING", (0, 0), (-1, -1), 8),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                    ]
                )
            )
            row.append(cell)
        card_rows.append(row)
        cards_table = Table(card_rows, colWidths=[46 * mm] * len(row), hAlign="LEFT")
        cards_table.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 8)]))
        story.append(cards_table)
        story.append(Spacer(1, 10))

    if not columns:
        story.append(Paragraph("No columns selected for this report.", value_style))
    else:
        header_row = [Paragraph(_human_label(column), table_header_style) for column in columns]
        body_rows = []
        for row in rows:
            body_rows.append(
                [Paragraph(_format_report_cell(columns[idx], cell), table_cell_style) for idx, cell in enumerate(row)]
            )
        table_data = [header_row] + body_rows
        available_width = doc.width
        col_width = available_width / max(len(columns), 1)
        col_widths = [col_width for _ in columns]
        report_table = Table(table_data, repeatRows=1, colWidths=col_widths, hAlign="LEFT")
        report_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EAF0FF")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#2746F5")),
                    ("FONTNAME", (0, 0), (-1, 0), bold_font),
                    ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#D7E1F2")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#E3EAF5")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FBFF")]),
                ]
            )
        )
        story.append(report_table)

    def _decorate_page(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#DBE5F6"))
        canvas.setFillColor(colors.HexColor("#2746F5"))
        canvas.rect(document.leftMargin, document.height + document.topMargin + 3 * mm, document.width, 5 * mm, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor("#5B6B86"))
        canvas.setFont(base_font, 8)
        canvas.drawRightString(document.pagesize[0] - document.rightMargin, 8 * mm, f"Page {canvas.getPageNumber()}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_decorate_page, onLaterPages=_decorate_page)
    return buffer.getvalue()


def default_export_meta(page_key: str, source_key: str, row_count: int) -> dict[str, Any]:
    return {
        "page": page_key,
        "source": source_key,
        "rows": row_count,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
