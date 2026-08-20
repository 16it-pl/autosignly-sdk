import hashlib
import hmac

import pytest

from autosignly import InvalidSignatureError
from autosignly import webhooks

SECRET = "wh_secret"
PAYLOAD = b'{"eventId":"1","eventType":"document.signed"}'


def signed(payload=PAYLOAD, secret=SECRET):
    return hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


def test_accepts_a_matching_signature():
    assert webhooks.is_valid(PAYLOAD, f"sha256={signed()}", SECRET) is True


def test_rejects_a_signature_for_different_bytes():
    assert webhooks.is_valid(b'{"eventId":"2"}', f"sha256={signed()}", SECRET) is False


def test_rejects_a_signature_made_with_another_secret():
    assert webhooks.is_valid(PAYLOAD, f"sha256={signed(secret='other')}", SECRET) is False


def test_accepts_when_one_of_several_signatures_matches():
    header = f"sha256=deadbeef,sha256={signed()}"
    assert webhooks.is_valid(PAYLOAD, header, SECRET) is True


def test_rejects_missing_header():
    assert webhooks.is_valid(PAYLOAD, "", SECRET) is False


def test_verify_raises_on_mismatch():
    with pytest.raises(InvalidSignatureError):
        webhooks.verify(PAYLOAD, "sha256=deadbeef", SECRET)
