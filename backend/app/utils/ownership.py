"""Ownership and record assignment utilities."""


def is_record_owner(record: dict | None, email: str | None, raised_by_field: str = "Raised By") -> bool:
    """
    Check if the given email owns (raised) the record.
    Case-insensitive comparison to handle email normalization differences.

    Args:
        record: Teable record dict with 'fields' key, or None
        email: Email to check (case-insensitive). If None, returns True
               (non-email-auth sessions are not ownership-gated).
        raised_by_field: Name of the Teable singleSelect field (default "Raised By")

    Returns:
        True if email matches the record's raised_by_field value (case-insensitive),
        or if email is None (non-email-auth session).
    """
    if not email:
        return True  # No email-auth session means no ownership gate
    raised_by = str((record or {}).get("fields", {}).get(raised_by_field) or "").strip()
    return raised_by.lower() == email.lower()
