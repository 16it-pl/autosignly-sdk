"""Contract test: every field name this client reads or sends must exist in the
published OpenAPI schema.

The field lists are not written by hand. Each parser is called with a mapping
that records which keys it asks for, so a parser that starts reading a different
key is checked automatically — which a hand-kept list would never do.

Runs offline against ``spec/autodocuments-v1.yaml``: no environment, no network.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import pytest
import yaml

from autosignly.client import _to_page
from autosignly.models import (
    Credentials,
    Document,
    DocumentSummary,
    Signer,
    SignerDetails,
    SignerStatus,
    SigningRequestResult,
    Tag,
)

SPEC = yaml.safe_load(
    (Path(__file__).resolve().parents[3] / "spec" / "autodocuments-v1.yaml").read_text()
)


def properties_of(schema: str) -> set[str]:
    found = SPEC["components"]["schemas"].get(schema)
    assert found is not None, f"schema {schema} is missing from the spec"
    return set(found.get("properties") or {})


class Recorder(dict):
    """A payload that remembers every key asked of it."""

    def __init__(self) -> None:
        super().__init__()
        self.seen: set[str] = set()

    def get(self, key: str, default: Any = None) -> Any:
        self.seen.add(key)
        return default

    def __getitem__(self, key: str) -> Any:
        self.seen.add(key)
        raise KeyError(key)


def keys_read_by(parse: Callable[[dict], Any]) -> set[str]:
    recorder = Recorder()
    try:
        parse(recorder)
    except KeyError:
        pass
    return recorder.seen


PARSERS = [
    ("Document", "DocumentInfoResponse", Document.from_payload),
    ("DocumentSummary", "DocumentListItemResponse", DocumentSummary.from_payload),
    ("SignerDetails", "SignerResponse", SignerDetails.from_payload),
    ("SignerStatus", "SignerStatusResponse", SignerStatus.from_payload),
    ("Credentials", "CredentialsResponse", Credentials.from_payload),
    ("SigningRequestResult", "SendForSigningResponse", SigningRequestResult.from_payload),
    ("Tag", "TagResponse1", Tag.from_payload),
]


@pytest.mark.parametrize(("name", "schema", "parse"), PARSERS, ids=[p[0] for p in PARSERS])
def test_parser_only_reads_declared_fields(name: str, schema: str, parse) -> None:
    unknown = sorted(keys_read_by(parse) - properties_of(schema))
    assert unknown == [], f"{name} reads fields the API does not send: {', '.join(unknown)}"


def test_page_reads_the_envelope_the_api_sends() -> None:
    envelope = properties_of("PageResponseDocumentListItemResponseV1")
    unknown = sorted(keys_read_by(lambda payload: _to_page(payload, lambda item: None)) - envelope)
    assert unknown == []

    info = properties_of("PageInfo")
    for counter in ("number", "size", "totalElements", "totalPages"):
        assert counter in info, f"PageInfo lost {counter}"


def test_signer_sends_only_fields_the_api_accepts() -> None:
    payload = Signer(
        first_name="Anna",
        last_name="Nowak",
        email="anna@example.com",
        country="PL",
        phone_number="+48123456789",
        locale="pl",
        order=1,
        signature_type="AES",
        signature_verification_method="SMS",
    ).to_payload()

    unknown = sorted(set(payload) - properties_of("ExternalSignerRequest"))
    assert unknown == [], f"unknown signer fields: {', '.join(unknown)}"


def test_every_endpoint_the_client_calls_exists() -> None:
    called = {
        "/api/publics/v1/api-key",
        "/api/publics/v1/credentials",
        "/api/publics/v1/documents",
        "/api/publics/v1/documents/{documentId}",
        "/api/publics/v1/documents/signings",
        "/api/publics/v1/documents/{documentId}/send-for-signing",
        "/api/publics/v1/documents/{documentId}/tags",
        "/api/publics/v1/tags",
        "/api/publics/v1/tags/{tagId}",
    }
    missing = sorted(called - set(SPEC["paths"]))
    assert missing == [], f"endpoints gone from the API: {', '.join(missing)}"
