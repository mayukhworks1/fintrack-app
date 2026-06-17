"""Translate Teable API errors to user-friendly messages."""

import json
import logging

logger = logging.getLogger(__name__)


def translate_teable_error(error_response: str | dict, context: str = "") -> str:
    """
    Translate a Teable API error response to a user-friendly message.

    Args:
        error_response: Error response from Teable (string or dict)
        context: Additional context about the operation (e.g., "creating invoice")

    Returns:
        User-friendly error message
    """
    try:
        if isinstance(error_response, str):
            try:
                data = json.loads(error_response)
            except json.JSONDecodeError:
                return error_response
        else:
            data = error_response

        # Extract the actual error message
        message = data.get("message", "")
        error_detail = data.get("error", {}) if isinstance(data.get("error"), dict) else {}
        teable_detail = error_detail.get("message", "")

        # Handle common Teable errors
        if "Invalid option" in message or "Invalid option" in teable_detail:
            # Extract field name if possible
            match_str = message + teable_detail
            field_match = match_str.split('"')[1] if '"' in match_str else "field"
            logger.warning(f"Teable invalid option error for {field_match}: {match_str}")
            return f"Invalid value for {field_match}. Please check the available options and try again."

        if "does not exist" in message.lower() or "not found" in message.lower():
            return "The requested record was not found. It may have been deleted."

        if "permission" in message.lower() or "unauthorized" in message.lower():
            return "You don't have permission to perform this action."

        if "duplicate" in message.lower() or "unique" in message.lower():
            return "This value already exists. Please use a different value."

        if "validation" in message.lower() or "validation_error" in message.lower():
            return f"Invalid data provided: {message}. Please check your input and try again."

        # If we have a clear message, use it
        if message:
            return f"Operation failed: {message}. Please try again or contact support if the problem persists."

        if teable_detail:
            return f"Operation failed: {teable_detail}. Please try again."

        return "An error occurred while processing your request. Please try again later."

    except Exception as e:
        logger.error(f"Error translating Teable error: {e}")
        return "An unexpected error occurred. Please try again later."
