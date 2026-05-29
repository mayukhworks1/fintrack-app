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
    printable_lines: list[str] = [title, ""]
    for key, value in meta.items():
        printable_lines.append(f"{key}: {value}")
    if meta:
        printable_lines.append("")
    header = " | ".join(columns)
    printable_lines.append(header)
    printable_lines.append("-" * min(max(len(header), 24), 110))
    for row in rows:
        line = " | ".join(_cell(cell) for cell in row)
        if len(line) > 110:
            line = line[:107] + "..."
        printable_lines.append(line)

    lines_per_page = 42
    page_height = 792
    line_height = 15
    pages: list[str] = []
    for start in range(0, len(printable_lines), lines_per_page):
        chunk = printable_lines[start:start + lines_per_page]
        y = page_height - 54
        commands = ["BT", "/F1 10 Tf", "48 0 0 48 0 0 Tm"]
        for line in chunk:
            commands.append(f"1 0 0 1 48 {y} Tm ({_escape_pdf_text(line)}) Tj")
            y -= line_height
        commands.append("ET")
        pages.append("\n".join(commands))

    objects: list[bytes] = []

    def add_object(payload: str) -> int:
        objects.append(payload.encode("utf-8"))
        return len(objects)

    font_obj = add_object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_ids: list[int] = []
    content_ids: list[int] = []
    pages_obj_placeholder = add_object("")
    for page in pages:
        content_id = add_object(f"<< /Length {len(page.encode('utf-8'))} >>\nstream\n{page}\nendstream")
        content_ids.append(content_id)
        page_id = add_object(
            f"<< /Type /Page /Parent {pages_obj_placeholder} 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font_obj} 0 R >> >> /Contents {content_id} 0 R >>"
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
