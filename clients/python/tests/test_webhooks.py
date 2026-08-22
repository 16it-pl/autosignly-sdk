import hashlib
import hmac
import time

import pytest

from autosignly import InvalidSignatureError
from autosignly import webhooks

SECRET = "wh_secret"
PAYLOAD = b'{"eventId":"1","eventType":"document.signed"}'


def now():
    return str(int(time.time()))


def signed(payload=PAYLOAD, secret=SECRET, timestamp=None):
    timestamp = timestamp or now()
    content = timestamp.encode() + b"." + payload
    return hmac.new(secret.encode(), content, hashlib.sha256).hexdigest()


def test_accepts_a_matching_signature():
    ts = now()
    assert webhooks.is_valid(PAYLOAD, f"v1={signed(timestamp=ts)}", SECRET, ts) is True


def test_signature_covers_the_timestamp():
    ts = now()
    other = str(int(ts) - 1)
    assert webhooks.is_valid(PAYLOAD, f"v1={signed(timestamp=other)}", SECRET, ts) is False


def test_rejects_a_signature_for_different_bytes():
    ts = now()
    assert webhooks.is_valid(b'{"eventId":"2"}', f"v1={signed(timestamp=ts)}", SECRET, ts) is False


def test_rejects_a_signature_made_with_another_secret():
    ts = now()
    assert webhooks.is_valid(PAYLOAD, f"v1={signed(secret='other', timestamp=ts)}", SECRET, ts) is False


def test_accepts_when_one_of_several_signatures_matches():
    ts = now()
    header = f"v1=deadbeef,v1={signed(timestamp=ts)}"
    assert webhooks.is_valid(PAYLOAD, header, SECRET, ts) is True


def test_rejects_an_old_delivery_even_with_a_valid_signature():
    ts = str(int(time.time()) - 3600)
    assert webhooks.is_valid(PAYLOAD, f"v1={signed(timestamp=ts)}", SECRET, ts) is False


def test_tolerance_can_be_disabled():
    ts = str(int(time.time()) - 3600)
    assert webhooks.is_valid(PAYLOAD, f"v1={signed(timestamp=ts)}", SECRET, ts, tolerance=0) is True


def test_rejects_an_unknown_signature_version():
    ts = now()
    assert webhooks.is_valid(PAYLOAD, f"v2={signed(timestamp=ts)}", SECRET, ts) is False


def test_rejects_missing_header_or_timestamp():
    ts = now()
    assert webhooks.is_valid(PAYLOAD, "", SECRET, ts) is False
    assert webhooks.is_valid(PAYLOAD, f"v1={signed(timestamp=ts)}", SECRET, "") is False


def test_verify_raises_on_mismatch():
    with pytest.raises(InvalidSignatureError):
        webhooks.verify(PAYLOAD, "v1=deadbeef", SECRET, now())
