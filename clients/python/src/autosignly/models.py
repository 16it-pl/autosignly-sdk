"""Data types returned by and passed to the Autosignly API.

Status and type values are plain strings rather than enums on purpose: the API
may gain new values over time, and a client that raises on an unknown value
would break on a server-side addition. The classes below list the values known
at the time of release, for convenience and autocompletion.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Generic, Iterator, TypeVar

T = TypeVar("T")


class SignatureType:
    """Level of the electronic signature requested for a document or signer."""

    QES = "QES"
    AES = "AES"
    SES = "SES"


class VerificationMethod:
    """How an advanced signature verifies the signer's identity."""

    SMS = "SMS"
    WK = "WK"
    BIOMETRIC = "BIOMETRIC"


class SigningMode:
    """Whether a document still needs signatures."""

    REQUIRES_SIGNATURE = "REQUIRES_SIGNATURE"
    ALREADY_SIGNED = "ALREADY_SIGNED"


class DocumentStatus:
    """Lifecycle of a document."""

    GENERATED = "GENERATED"
    SIGNERS_ASSIGNED = "SIGNERS_ASSIGNED"
    WAITING_FOR_SIGNATURE = "WAITING_FOR_SIGNATURE"
    SIGNING_IN_PROGRESS = "SIGNING_IN_PROGRESS"
    SIGNED = "SIGNED"
    CANCELLED = "CANCELLED"


class SigningStatus:
    """State of an individual signer within a signing request."""

    SENT = "SENT"
    AWAITING_SIGNATURE = "AWAITING_SIGNATURE"


@dataclass(slots=True)
class Signer:
    """A person asked to sign a document."""

    first_name: str
    last_name: str
    email: str
    country: str
    phone_number: str | None = None
    locale: str | None = None
    order: int | None = None
    signature_type: str | None = None
    signature_verification_method: str | None = None

    def to_payload(self) -> dict[str, Any]:
        payload = {
            "firstName": self.first_name,
            "lastName": self.last_name,
            "email": self.email,
            "country": self.country,
            "phoneNumber": self.phone_number,
            "locale": self.locale,
            "order": self.order,
            "signatureType": self.signature_type,
            "signatureVerificationMethod": self.signature_verification_method,
        }
        return {key: value for key, value in payload.items() if value is not None}


@dataclass(slots=True)
class Tag:
    """A company tag, used to group documents and templates."""

    id: str
    name: str
    color: str | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "Tag":
        return cls(id=payload["id"], name=payload["name"], color=payload.get("color"))


@dataclass(slots=True)
class SignerStatus:
    """Where a signer stands, and the link they were given."""

    email: str
    status: str | None = None
    sign_url: str | None = None
    expires_at: str | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "SignerStatus":
        return cls(
            email=payload.get("email", ""),
            status=payload.get("status"),
            sign_url=payload.get("signUrl"),
            expires_at=payload.get("expiresAt"),
        )


@dataclass(slots=True)
class SignerDetails:
    """A signer as stored on a document."""

    email: str
    first_name: str | None = None
    last_name: str | None = None
    phone_number: str | None = None
    country: str | None = None
    locale: str | None = None
    signature_type: str | None = None
    signature_verification_method: str | None = None
    signing_order: int | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "SignerDetails":
        return cls(
            email=payload.get("email", ""),
            first_name=payload.get("firstName"),
            last_name=payload.get("lastName"),
            phone_number=payload.get("phoneNumber"),
            country=payload.get("country"),
            locale=payload.get("locale"),
            signature_type=payload.get("signatureType"),
            signature_verification_method=payload.get("signatureVerificationMethod"),
            signing_order=payload.get("signingOrder"),
        )


@dataclass(slots=True)
class Document:
    """Full details of a document, including its signers and a link to its file.

    ``file_url`` is short-lived. Fetch the document again to obtain a fresh link
    rather than storing it. A document that is still being signed can be
    downloaded as well; it then carries only the signatures collected so far.
    """

    id: str
    name: str | None = None
    company_id: str | None = None
    status: str | None = None
    signing_mode: str | None = None
    signers: list[SignerDetails] = field(default_factory=list)
    tags: list[Tag] = field(default_factory=list)
    file_url: str | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "Document":
        return cls(
            id=payload["id"],
            name=payload.get("name"),
            company_id=payload.get("companyId"),
            status=payload.get("status"),
            signing_mode=payload.get("signingMode"),
            signers=[SignerDetails.from_payload(s) for s in payload.get("signerResponses") or []],
            tags=[Tag.from_payload(t) for t in payload.get("tags") or []],
            file_url=payload.get("fileUrl"),
        )


@dataclass(slots=True)
class DocumentSummary:
    """A document as it appears in a list."""

    id: str
    name: str | None = None
    status: str | None = None
    signing_mode: str | None = None
    created_at: str | None = None
    tags: list[Tag] = field(default_factory=list)

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "DocumentSummary":
        return cls(
            id=payload["id"],
            name=payload.get("name"),
            status=payload.get("status"),
            signing_mode=payload.get("signingMode"),
            created_at=payload.get("createdAt"),
            tags=[Tag.from_payload(t) for t in payload.get("tags") or []],
        )


@dataclass(slots=True)
class SigningRequestResult:
    """Outcome of sending a document for signature.

    Only the first signer receives a link immediately; the others are e-mailed
    their link when their turn comes.
    """

    document_id: str
    status: str | None = None
    signers: list[SignerStatus] = field(default_factory=list)

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "SigningRequestResult":
        return cls(
            document_id=payload.get("documentId", ""),
            status=payload.get("status"),
            signers=[SignerStatus.from_payload(s) for s in payload.get("signers") or []],
        )


@dataclass(slots=True)
class Page(Generic[T]):
    """One page of a paged listing."""

    content: list[T]
    number: int = 0
    size: int = 0
    total_elements: int = 0
    total_pages: int = 0

    def __iter__(self) -> Iterator[T]:
        return iter(self.content)

    def __len__(self) -> int:
        return len(self.content)

    @property
    def has_next(self) -> bool:
        return self.number + 1 < self.total_pages
