"""Verification of webhook deliveries.

Every delivery carries two headers: ``X-Webhook-Timestamp`` with the moment it
was signed, and ``X-Webhook-Signature`` with one or more signatures over
``timestamp + "." + body``. Several signatures appear while a webhook key is
being rotated; a delivery is genuine when any of them matches.
"""

from __future__ import annotations

import hashlib
import hmac
import time

from .errors import InvalidSignatureError

SIGNATURE_HEADER = "X-Webhook-Signature"
TIMESTAMP_HEADER = "X-Webhook-Timestamp"

SIGNATURE_VERSION = "v1"
DEFAULT_TOLERANCE_SECONDS = 300


def compute_signature(payload: bytes, secret: str, timestamp: str) -> str:
    """Return the hex digest Autosignly sends for this payload and timestamp."""
    signed_content = timestamp.encode("utf-8") + b"." + payload
    return hmac.new(secret.encode("utf-8"), signed_content, hashlib.sha256).hexdigest()


def is_valid(
    payload: bytes,
    signature_header: str,
    secret: str,
    timestamp: str,
    *,
    tolerance: int = DEFAULT_TOLERANCE_SECONDS,
) -> bool:
    """Check a delivery without raising.

    ``payload`` must be the raw request body exactly as received. Parsing and
    re-serialising the JSON changes the bytes and invalidates the signature.

    A delivery older than ``tolerance`` seconds is rejected even when its
    signature matches, so a captured request cannot be replayed later. Pass
    ``tolerance=0`` to skip that check.
    """
    if not signature_header or not secret or not timestamp:
        return False

    if tolerance and not _is_fresh(timestamp, tolerance):
        return False

    expected = compute_signature(payload, secret, timestamp)
    for candidate in signature_header.split(","):
        version, _, digest = candidate.strip().partition("=")
        if version == SIGNATURE_VERSION and digest and hmac.compare_digest(digest, expected):
            return True
    return False


def verify(
    payload: bytes,
    signature_header: str,
    secret: str,
    timestamp: str,
    *,
    tolerance: int = DEFAULT_TOLERANCE_SECONDS,
) -> None:
    """Check a delivery and raise :class:`InvalidSignatureError` if it fails."""
    if not is_valid(payload, signature_header, secret, timestamp, tolerance=tolerance):
        raise InvalidSignatureError("Webhook signature does not match the payload")


def _is_fresh(timestamp: str, tolerance: int) -> bool:
    try:
        sent_at = int(timestamp.strip())
    except ValueError:
        return False
    return abs(time.time() - sent_at) <= tolerance
