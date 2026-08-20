"""Exceptions raised by the Autosignly client."""

from __future__ import annotations


class AutosignlyError(Exception):
    """Base class for every error raised by this library."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_type: str | None = None,
        error_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_type = error_type
        self.error_id = error_id

    def __str__(self) -> str:
        parts = [self.message]
        if self.error_type:
            parts.append(f"type={self.error_type}")
        if self.error_id:
            parts.append(f"errorId={self.error_id}")
        return " ".join(parts)


class AuthenticationError(AutosignlyError):
    """The API key or secret was rejected."""


class PermissionDeniedError(AutosignlyError):
    """The credentials are valid but do not grant access to this resource."""


class NotFoundError(AutosignlyError):
    """The requested resource does not exist."""


class ValidationError(AutosignlyError):
    """The request was rejected as invalid."""


class RateLimitError(AutosignlyError):
    """Too many requests were sent in a short period.

    ``retry_after`` carries the delay the API asked for, in seconds, when it
    provided one.
    """

    def __init__(self, message: str, *, retry_after: float | None = None, **kwargs) -> None:
        super().__init__(message, **kwargs)
        self.retry_after = retry_after


class ServerError(AutosignlyError):
    """The API failed to process the request."""


class ConnectionError(AutosignlyError):
    """The API could not be reached."""


class InvalidSignatureError(AutosignlyError):
    """A webhook signature did not match the payload."""
