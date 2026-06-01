from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _escape_pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:.2f}".rstrip("0").rstrip(".")
    return str(value)


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
    page_width = 842
    page_height = 595
    margin = 34
    content_width = page_width - (margin * 2)
    header_height = 54
    meta_card_height = 58
    footer_height = 24
    row_gap = 2

    def _key_label(key: str) -> str:
        return key.replace("_", " ").strip().title()

    def _clip_text(value: str, width: float, font_size: int) -> str:
        max_chars = max(4, int(width / max(font_size * 0.46, 1)))
        if len(value) <= max_chars:
            return value
        return value[: max(1, max_chars - 1)] + "…"

    summary_cards = meta.get("summary_cards") if isinstance(meta.get("summary_cards"), list) else []
    visible_meta = [
        ("page_label", _cell(meta.get("page_label") or title)),
        ("source_label", _cell(meta.get("source_label") or meta.get("source") or "")),
        ("rows", _cell(meta.get("rows") or len(rows))),
        ("columns", _cell(len(columns))),
        ("generated_at", _cell(meta.get("generated_at") or "")),
        ("filters_summary", _cell(meta.get("filters_summary") or "No active filters")),
    ]
    visible_meta = [(k, v) for k, v in visible_meta if v][:6]
    col_count = max(len(columns), 1)
    base_col_width = content_width / col_count
    col_widths = [base_col_width for _ in columns]

    def _draw_rect(x: float, y: float, w: float, h: float, fill_rgb: tuple[float, float, float], stroke_rgb: tuple[float, float, float] | None = None, line_width: float = 1.0) -> str:
        cmds = []
        if stroke_rgb is not None:
            cmds.append(f"{stroke_rgb[0]:.3f} {stroke_rgb[1]:.3f} {stroke_rgb[2]:.3f} RG")
            cmds.append(f"{line_width:.2f} w")
        cmds.append(f"{fill_rgb[0]:.3f} {fill_rgb[1]:.3f} {fill_rgb[2]:.3f} rg")
        cmds.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re")
        cmds.append("B" if stroke_rgb is not None else "f")
        return "\n".join(cmds)

    def _draw_text(x: float, y: float, text: str, font: str = "F1", size: int = 10, rgb: tuple[float, float, float] = (0.12, 0.16, 0.24)) -> str:
        return "\n".join(
            [
                "BT",
                f"/{font} {size} Tf",
                f"{rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f} rg",
                f"1 0 0 1 {x:.2f} {y:.2f} Tm",
                f"({_escape_pdf_text(text)}) Tj",
                "ET",
            ]
        )

    def _row_height(row: list[Any], font_size: int = 9) -> float:
        if not columns:
            return 20
        lines_needed = 1
        for idx, cell in enumerate(row):
            width = col_widths[min(idx, len(col_widths) - 1)] - 10
            max_chars = max(6, int(width / max(font_size * 0.45, 1)))
            text = _cell(cell)
            wrapped = max(1, (len(text) // max_chars) + (1 if len(text) % max_chars else 0))
            lines_needed = max(lines_needed, min(wrapped, 3))
        return 16 + ((lines_needed - 1) * 10)

    def _wrap_text(value: str, width: float, font_size: int, max_lines: int = 3) -> list[str]:
        text = _cell(value)
        max_chars = max(6, int(width / max(font_size * 0.45, 1)))
        if len(text) <= max_chars:
            return [text]
        words = text.split()
        if len(words) <= 1:
            return [_clip_text(text, width, font_size)]
        lines: list[str] = []
        current = ""
        for word in words:
            trial = f"{current} {word}".strip()
            if len(trial) <= max_chars:
                current = trial
            else:
                if current:
                    lines.append(current)
                current = word
            if len(lines) >= max_lines:
                break
        if current and len(lines) < max_lines:
            lines.append(current)
        if len(lines) == max_lines and len(" ".join(words)) > sum(len(line) for line in lines):
            lines[-1] = _clip_text(lines[-1], width, font_size)
        return lines[:max_lines]

    row_heights = [_row_height(row) for row in rows]

    def _page_commands(page_index: int, page_rows: list[tuple[list[Any], float]], start_row: int) -> str:
        cmds: list[str] = []
        # top header band
        cmds.append(_draw_rect(margin, page_height - margin - header_height, content_width, header_height, (0.16, 0.27, 0.96)))
        cmds.append(_draw_text(margin + 16, page_height - margin - 20, title, font="F2", size=20, rgb=(1, 1, 1)))
        subtitle = f"{pageLabel if (pageLabel := meta.get('page_label')) else 'Insight export'} · {len(rows)} rows · {len(columns)} columns"
        cmds.append(_draw_text(margin + 16, page_height - margin - 38, subtitle, font="F1", size=9, rgb=(0.91, 0.94, 1.0)))

        y = page_height - margin - header_height - 16
        if summary_cards:
            card_width = (content_width - 24) / min(4, max(len(summary_cards), 1))
            top_cards = summary_cards[:4]
            card_y = y - 28
            for idx, card in enumerate(top_cards):
                card_x = margin + (idx * (card_width + 8))
                cmds.append(_draw_rect(card_x, card_y, card_width, 26, (0.94, 0.97, 1.0), (0.86, 0.90, 0.98), 0.7))
                cmds.append(_draw_text(card_x + 8, card_y + 17, _clip_text(_cell(card.get("label")), card_width - 16, 7), font="F2", size=7, rgb=(0.38, 0.46, 0.63)))
                cmds.append(_draw_text(card_x + 8, card_y + 7, _clip_text(_cell(card.get("value")), card_width - 16, 10), font="F2", size=10, rgb=(0.12, 0.16, 0.24)))
            y = card_y - 14

        if visible_meta:
            meta_y = y - meta_card_height
            chip_width = (content_width - 12) / 2
            for idx, (key, value) in enumerate(visible_meta):
                col = idx % 2
                row = idx // 2
                chip_x = margin + (col * (chip_width + 12))
                chip_y = meta_y - (row * 22)
                cmds.append(_draw_rect(chip_x, chip_y, chip_width, 18, (0.95, 0.97, 1.0), (0.86, 0.90, 0.98), 0.7))
                cmds.append(_draw_text(chip_x + 8, chip_y + 11, _key_label(key), font="F2", size=7, rgb=(0.38, 0.46, 0.63)))
                cmds.append(_draw_text(chip_x + 78, chip_y + 11, _clip_text(value, chip_width - 86, 8), font="F1", size=8, rgb=(0.12, 0.16, 0.24)))
            y = meta_y - 34

        # table header
        table_header_y = y
        cmds.append(_draw_rect(margin, table_header_y - 20, content_width, 20, (0.90, 0.94, 1.0), (0.83, 0.88, 0.96), 0.8))
        x = margin
        for idx, column in enumerate(columns):
            width = col_widths[idx]
            cmds.append(_draw_text(x + 6, table_header_y - 13, _clip_text(column, width - 12, 8), font="F2", size=8, rgb=(0.19, 0.28, 0.52)))
            x += width
        y = table_header_y - 22

        for idx, (row, height) in enumerate(page_rows):
            row_y = y - height
            fill = (1.0, 1.0, 1.0) if (start_row + idx) % 2 == 0 else (0.975, 0.982, 1.0)
            cmds.append(_draw_rect(margin, row_y, content_width, height, fill, (0.90, 0.93, 0.98), 0.5))
            x = margin
            for cell_idx, cell in enumerate(row):
                width = col_widths[min(cell_idx, len(col_widths) - 1)]
                wrapped = _wrap_text(_cell(cell), width - 12, 9, max_lines=3)
                for line_idx, line in enumerate(wrapped):
                    cmds.append(_draw_text(x + 6, row_y + height - 13 - (line_idx * 9), line, font="F1", size=9, rgb=(0.15, 0.18, 0.26)))
                x += width
            y = row_y - row_gap

        footer = f"Page {page_index + 1}"
        cmds.append(_draw_text(page_width - margin - 42, footer_height, footer, font="F1", size=8, rgb=(0.50, 0.57, 0.68)))
        return "\n".join(cmds)

    available_table_height_first = page_height - (margin * 2) - header_height - meta_card_height - footer_height - 48
    available_table_height_other = page_height - (margin * 2) - header_height - footer_height - 48

    pages: list[str] = []
    cursor = 0
    page_index = 0
    while cursor < len(rows):
        budget = available_table_height_first if page_index == 0 else available_table_height_other
        page_rows: list[tuple[list[Any], float]] = []
        used = 20.0  # table header
        while cursor < len(rows):
            next_height = row_heights[cursor] + row_gap
            if page_rows and used + next_height > budget:
                break
            if not page_rows and next_height > budget:
                next_height = min(next_height, budget)
            page_rows.append((rows[cursor], row_heights[cursor]))
            used += next_height
            cursor += 1
        pages.append(_page_commands(page_index, page_rows, cursor - len(page_rows)))
        page_index += 1

    if not pages:
        pages.append(_page_commands(0, [], 0))

    objects: list[bytes] = []

    def add_object(payload: str) -> int:
        objects.append(payload.encode("utf-8"))
        return len(objects)

    font_obj = add_object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    font_bold_obj = add_object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
    page_ids: list[int] = []
    content_ids: list[int] = []
    pages_obj_placeholder = add_object("")
    for page in pages:
        content_id = add_object(f"<< /Length {len(page.encode('utf-8'))} >>\nstream\n{page}\nendstream")
        content_ids.append(content_id)
        page_id = add_object(
            f"<< /Type /Page /Parent {pages_obj_placeholder} 0 R "
            f"/Resources << /Font << /F1 {font_obj} 0 R /F2 {font_bold_obj} 0 R >> >> "
            f"/MediaBox [0 0 {page_width} {page_height}] /Contents {content_id} 0 R >>"
        )
        page_ids.append(page_id)

    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects[pages_obj_placeholder - 1] = f"<< /Type /Pages /Count {len(page_ids)} /Kids [{kids}] >>".encode("utf-8")
    catalog_obj = add_object(f"<< /Type /Catalog /Pages {pages_obj_placeholder} 0 R >>")

    pdf = bytearray(b"%PDF-1.4\n")
    xref_positions = [0]
    for idx, obj in enumerate(objects, start=1):
        xref_positions.append(len(pdf))
        pdf.extend(f"{idx} 0 obj\n".encode("utf-8"))
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")
    xref_start = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("utf-8"))
    pdf.extend(b"0000000000 65535 f \n")
    for pos in xref_positions[1:]:
        pdf.extend(f"{pos:010d} 00000 n \n".encode("utf-8"))
    pdf.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_obj} 0 R >>\nstartxref\n{xref_start}\n%%EOF".encode(
            "utf-8"
        )
    )
    return bytes(pdf)


def default_export_meta(page_key: str, source_key: str, row_count: int) -> dict[str, Any]:
    return {
        "page": page_key,
        "source": source_key,
        "rows": row_count,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
