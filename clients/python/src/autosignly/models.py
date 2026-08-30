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


class SignatureMode:
    """Where signatures are placed on the document."""

    #: The signer places a visual stamp on the document.
    STAMP = "STAMP"
    #: Signatures are collected on a card appended to the document.
    SIGNATURES_CARD = "SIGNATURES_CARD"


class EnvironmentType:
    """Which environment a key and secret pair belongs to."""

    PROD = "PROD"
    SANDBOX = "SANDBOX"


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


class AttachmentFormat:
    """Format of an attached file, detected from its content."""

    PDF = "PDF"
    JPEG = "JPEG"
    PNG = "PNG"


class AttachmentStatus:
    """Whether an attachment is ready to be merged into the document."""

    #: Converted to PDF and ready to be merged.
    READY = "READY"
    #: Conversion failed; the attachment is skipped when the document is signed.
    FAILED = "FAILED"


class SigningStatus:
    """State of an individual signer within a signing request."""

    SENT = "SENT"
    AWAITING_SIGNATURE = "AWAITING_SIGNATURE"


@dataclass(slots=True)
class Credentials:
    """Which company and environment a key and secret pair resolves to.

    Every environment — production and each sandbox — has its own pair, so this
    is how a caller confirms which data a key will touch before using it.
    """

    valid: bool
    company_id: str | None = None
    environment_id: str | None = None
    environment_type: str | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "Credentials":
        return cls(
            valid=bool(payload.get("valid", False)),
            company_id=payload.get("companyId"),
            environment_id=payload.get("environmentId"),
            environment_type=payload.get("environmentType"),
        )


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


class PartyType:
    """Whether a party is a business or a natural person."""

    COMPANY = "COMPANY"
    PERSON = "PERSON"


@dataclass(slots=True)
class PartyAddress:
    """Registered address of a party."""

    street: str | None = None
    number: str | None = None
    postal_code: str | None = None
    city: str | None = None
    country_code: str | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "PartyAddress":
        return cls(
            street=payload.get("street"),
            number=payload.get("number"),
            postal_code=payload.get("postalCode"),
            city=payload.get("city"),
            country_code=payload.get("countryCode"),
        )

    def to_payload(self) -> dict[str, Any]:
        payload = {
            "street": self.street,
            "number": self.number,
            "postalCode": self.postal_code,
            "city": self.city,
            "countryCode": self.country_code,
        }
        return {key: value for key, value in payload.items() if value is not None}


@dataclass(slots=True)
class Party:
    """A counterparty of the company — the other side of a document.

    A ``COMPANY`` is identified by ``tax_id`` and needs an ``address``; a
    ``PERSON`` needs a ``firstname`` and an ``email``. Parties belong to the
    environment of the key that created them, so a sandbox key never sees a
    production party.
    """

    type: str
    name: str
    firstname: str | None = None
    tax_id: str | None = None
    email: str | None = None
    phone: str | None = None
    address: PartyAddress | None = None
    id: str | None = None
    created_at: str | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "Party":
        address = payload.get("address")
        return cls(
            type=payload.get("type", ""),
            name=payload.get("name", ""),
            firstname=payload.get("firstname"),
            tax_id=payload.get("taxId"),
            email=payload.get("email"),
            phone=payload.get("phone"),
            address=PartyAddress.from_payload(address) if address else None,
            id=payload.get("id"),
            created_at=payload.get("createdAt"),
        )

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "type": self.type,
            "name": self.name,
            "firstname": self.firstname,
            "taxId": self.tax_id,
            "email": self.email,
            "phone": self.phone,
            "address": self.address.to_payload() if self.address else None,
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
class AllowedSignatureType:
    """One signature type a signer from a given country may be asked for."""

    type: str | None = None
    #: Only for AES: how such a signer may confirm their identity. Empty for SES and QES.
    verification_methods: list[str] = field(default_factory=list)

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "AllowedSignatureType":
        return cls(
            type=payload.get("type"),
            verification_methods=list(payload.get("verificationMethods") or []),
        )


@dataclass(slots=True)
class SignaturePolicy:
    """What may be asked of a signer from one country.

    Sending a signer with a combination this policy does not list is rejected when
    the document goes out, so read the policy before building your signer form.
    """

    country: str | None = None
    #: True for the fallback entry, which covers every country without its own rules.
    default_policy: bool = False
    signature_types: list[AllowedSignatureType] = field(default_factory=list)

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "SignaturePolicy":
        return cls(
            country=payload.get("country"),
            default_policy=bool(payload.get("defaultPolicy", False)),
            signature_types=[
                AllowedSignatureType.from_payload(item) for item in payload.get("signatureTypes") or []
            ],
        )


@dataclass(slots=True)
class SmsCountry:
    """A country an SMS verification code can be delivered to."""

    country_code: str | None = None
    name: str | None = None
    #: International dialing prefix the phone number has to start with, e.g. "+48".
    dialing_prefix: str | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "SmsCountry":
        return cls(
            country_code=payload.get("countryCode"),
            name=payload.get("name"),
            dialing_prefix=payload.get("dialingPrefix"),
        )


@dataclass(slots=True)
class Attachment:
    """A file attached to a document.

    Attachments are converted to PDF and merged into the document when it is
    sent for signing, behind an index page listing each one with its checksum,
    so a single signature covers the document and everything attached to it.
    """

    id: str
    order_index: int = 0
    file_name: str | None = None
    format: str | None = None
    size_bytes: int = 0
    sha256: str | None = None
    page_count: int | None = None
    status: str | None = None
    file_url: str | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "Attachment":
        return cls(
            id=payload["id"],
            order_index=payload.get("orderIndex", 0),
            file_name=payload.get("fileName"),
            format=payload.get("format"),
            size_bytes=payload.get("sizeBytes", 0),
            sha256=payload.get("sha256"),
            page_count=payload.get("pageCount"),
            status=payload.get("status"),
            file_url=payload.get("fileUrl"),
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
