"""Verification of webhook deliveries."""

from __future__ import annotations

import hashlib
import hmac

from .errors import InvalidSignatureError

SIGNATURE_HEADER = "X-Webhook-Signature"


def compute_signature(payload: bytes, secret: str) -> str:
    """Return the hex digest Autosignly sends for this payload."""
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def is_valid(payload: bytes, signature_header: str, secret: str) -> bool:
    """Check a delivery without raising.

    ``payload`` must be the raw request body exactly as received. Parsing and
    re-serialising the JSON changes the bytes and invalidates the signature.
    """
    if not signature_header or not secret:
        return False

    expected = compute_signature(payload, secret)
    for candidate in signature_header.split(","):
        candidate = candidate.strip()
        _, _, digest = candidate.rpartition("=")
        if digest and hmac.compare_digest(digest, expected):
            return True
    return False


def verify(payload: bytes, signature_header: str, secret: str) -> None:
    """Check a delivery and raise :class:`InvalidSignatureError` if it fails."""
    if not is_valid(payload, signature_header, secret):
        raise InvalidSignatureError("Webhook signature does not match the payload")
