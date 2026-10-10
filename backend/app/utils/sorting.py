"""
Sort keys for Teable cell values sorted in Python.

A Teable column is not one type: a number column holds floats on some records
and nothing at all on others, and the old key `value or ""` turned a missing
cell, None and 0 alike into "". Sorting such a column compared float with str
and raised TypeError, so the invoice list answered 500 for as long as the user
kept that column selected.
"""

from __future__ import annotations

from typing import Any


def cell_sort_key(value: Any) -> tuple:
    """
    A key that orders any mix of cell values without comparing unlike types.

    Blanks (None, "", empty list) sort lowest, as "" always did, so they stay
    last in the default descending order. Numbers come next, ordered by value,
    with 0 a value rather than a blank. Text, dates (ISO strings) and anything
    else come last, ordered as strings.
    """
    if value is None or value == "" or value == []:
        return (0,)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return (1, float(value))
    if isinstance(value, str):
        return (2, value)
    return (2, str(value))
