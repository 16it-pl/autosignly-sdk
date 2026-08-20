"""Python client for the Autosignly API.

    from autosignly import AutosignlyClient, Signer

    with AutosignlyClient(api_key="api_key_...", api_secret="api_sct_...") as client:
        result = client.upload_and_sign(
            pdf=open("contract.pdf", "rb").read(),
            document_name="Contract",
            signers=[Signer(first_name="Anna", last_name="Nowak",
                            email="anna@example.com", country="PL")],
        )
        print(result.document_id)
"""

from ._version import __version__
from .client import AutosignlyClient, PRODUCTION_BASE_URL
from .errors import (
    AutosignlyError,
    AuthenticationError,
    ConnectionError,
    InvalidSignatureError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
    ServerError,
    ValidationError,
)
from .models import (
    Document,
    DocumentStatus,
    DocumentSummary,
    Page,
    SignatureType,
    Signer,
    SignerDetails,
    SignerStatus,
    SigningMode,
    SigningRequestResult,
    SigningStatus,
    Tag,
    VerificationMethod,
)

__all__ = [
    "AutosignlyClient",
    "PRODUCTION_BASE_URL",
    "AutosignlyError",
    "AuthenticationError",
    "ConnectionError",
    "InvalidSignatureError",
    "NotFoundError",
    "PermissionDeniedError",
    "RateLimitError",
    "ServerError",
    "ValidationError",
    "Document",
    "DocumentStatus",
    "DocumentSummary",
    "Page",
    "SignatureType",
    "Signer",
    "SignerDetails",
    "SignerStatus",
    "SigningMode",
    "SigningRequestResult",
    "SigningStatus",
    "Tag",
    "VerificationMethod",
    "webhooks",
]
