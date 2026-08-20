"""HTTP client for the Autosignly public API."""

from __future__ import annotations

import json
import random
import time
import uuid
from typing import Any, Iterator, Mapping, Sequence

import httpx

from . import errors
from ._version import __version__
from .models import (
    Document,
    DocumentSummary,
    Page,
    Signer,
    SigningRequestResult,
    Tag,
)

PRODUCTION_BASE_URL = "https://app.autosignly.eu/api"
API_PREFIX = "/publics/v1"

_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
_MAX_RETRY_DELAY = 60.0
_IDEMPOTENT_METHODS = frozenset({"GET", "DELETE"})


class AutosignlyClient:
    """Client for the Autosignly API.

    Credentials are a key and secret pair created in the Autosignly application.
    Each environment, production or sandbox, has its own pair, and the pair
    decides which environment a call operates on.

    The secret must never reach a browser or a mobile app. This client is meant
    to run on your own server.
    """

    def __init__(
        self,
        api_key: str,
        api_secret: str,
        *,
        base_url: str = PRODUCTION_BASE_URL,
        timeout: float = 30.0,
        max_retries: int = 2,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not api_key or not api_secret:
            raise ValueError("api_key and api_secret are required")

        self._base_url = base_url.rstrip("/")
        self._max_retries = max(0, max_retries)
        self._owns_client = http_client is None
        self._http = http_client or httpx.Client(timeout=timeout)
        self._headers = {
            "X-API-KEY": api_key,
            "X-API-SECRET": api_secret,
            "Accept": "application/json",
            "User-Agent": f"autosignly-python/{__version__}",
        }

    def __enter__(self) -> "AutosignlyClient":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def close(self) -> None:
        """Release the underlying connection pool."""
        if self._owns_client:
            self._http.close()

    # -- credentials ---------------------------------------------------------

    def validate_credentials(self) -> bool:
        """Report whether this key and secret pair is accepted.

        Invalid credentials return ``False`` rather than raising, mirroring the
        API, which never answers this call with an authentication error so that
        keys cannot be probed.
        """
        payload = self._request("GET", "/api-key")
        return bool(payload.get("valid", False))

    # -- documents -----------------------------------------------------------

    def list_documents(
        self,
        *,
        status: str | Sequence[str] | None = None,
        page: int = 0,
        size: int = 20,
        sort: str | None = None,
    ) -> Page[DocumentSummary]:
        """Return one page of documents belonging to this environment."""
        params: list[tuple[str, Any]] = [("page", page), ("size", size)]
        if sort:
            params.append(("sort", sort))
        if status:
            values = [status] if isinstance(status, str) else list(status)
            params.extend(("status", value) for value in values)

        payload = self._request("GET", "/documents", params=params)
        return _to_page(payload, DocumentSummary.from_payload)

    def iter_documents(
        self,
        *,
        status: str | Sequence[str] | None = None,
        size: int = 50,
        sort: str | None = None,
    ) -> Iterator[DocumentSummary]:
        """Walk every document, fetching further pages as needed."""
        page_number = 0
        while True:
            page = self.list_documents(status=status, page=page_number, size=size, sort=sort)
            yield from page.content
            if not page.has_next:
                return
            page_number += 1

    def get_document(self, document_id: str) -> Document:
        """Return one document with its signers."""
        payload = self._request("GET", f"/documents/{document_id}")
        return Document.from_payload(payload)

    def download_document(self, document_id: str) -> bytes:
        """Fetch the current file of a document.

        Resolves a fresh link through :meth:`get_document` and downloads it. A
        document that is still being signed can be downloaded too; it then
        carries only the signatures collected so far.
        """
        document = self.get_document(document_id)
        if not document.file_url:
            raise errors.NotFoundError(
                f"Document {document_id} has no file to download",
                status_code=404,
            )

        try:
            response = self._http.get(document.file_url)
        except httpx.TransportError as exc:
            raise errors.ConnectionError(f"Could not download {document_id}: {exc}") from exc

        if response.status_code >= 400:
            raise _to_error(response)
        return response.content

    def send_for_signing(
        self,
        document_id: str,
        *,
        signers: Sequence[Signer] | None = None,
        signature_type: str | None = None,
        verification_method: str | None = None,
        initiator_email: str | None = None,
        initiator_locale: str | None = None,
    ) -> SigningRequestResult:
        """Send an existing document to its signers.

        A document in ``GENERATED`` status needs ``signers``; one already in
        ``SIGNERS_ASSIGNED`` must be sent without them, since its signers are
        already stored.
        """
        body: dict[str, Any] = {}
        if signers:
            body["signers"] = [signer.to_payload() for signer in signers]
        if signature_type:
            body["signatureType"] = signature_type
        if verification_method:
            body["verificationMethod"] = verification_method
        if initiator_email:
            body["signingInitiatorData"] = {
                "email": initiator_email,
                "locale": initiator_locale,
            }

        payload = self._request("POST", f"/documents/{document_id}/send-for-signing", json_body=body)
        return SigningRequestResult.from_payload(payload)

    def upload_and_sign(
        self,
        *,
        pdf: bytes,
        document_name: str,
        signers: Sequence[Signer],
        signature_type: str | None = None,
        verification_method: str | None = None,
        initiator_email: str | None = None,
        initiator_locale: str | None = None,
        file_name: str = "document.pdf",
    ) -> str:
        """Upload a PDF and send it for signature in one call.

        Returns the identifier of the created document. Signing links are
        e-mailed to the signers directly.
        """
        request: dict[str, Any] = {
            "documentName": document_name,
            "signers": [signer.to_payload() for signer in signers],
        }
        if signature_type:
            request["signatureType"] = signature_type
        if verification_method:
            request["verificationMethod"] = verification_method
        if initiator_email:
            request["signingInitiatorData"] = {
                "email": initiator_email,
                "locale": initiator_locale,
            }

        files = {
            "file": (file_name, pdf, "application/pdf"),
            "request": (None, json.dumps(request), "application/json"),
        }
        payload = self._request("POST", "/documents/signings", files=files)
        return payload.get("documentId", "")

    # -- tags ----------------------------------------------------------------

    def list_tags(self, *, name: str | None = None, page: int = 0, size: int = 20) -> Page[Tag]:
        """Return one page of the company tag pool for this environment."""
        params: list[tuple[str, Any]] = [("page", page), ("size", size)]
        if name:
            params.append(("name", name))
        payload = self._request("GET", "/tags", params=params)
        return _to_page(payload, Tag.from_payload)

    def create_tag(self, name: str) -> Tag:
        """Add a tag, or return the existing one with the same name.

        Names are matched without regard to case, so repeating this call is safe.
        """
        payload = self._request("POST", "/tags", json_body={"name": name})
        return Tag.from_payload(payload)

    def delete_tag(self, tag_id: str) -> None:
        """Remove a tag from the pool and from every document carrying it."""
        self._request("DELETE", f"/tags/{tag_id}")

    def set_document_tags(
        self,
        document_id: str,
        *,
        tag_ids: Sequence[str] | None = None,
        names: Sequence[str] | None = None,
    ) -> list[Tag]:
        """Replace the whole tag set of a document.

        Tags left out are removed. Names that are not in the pool yet are added
        to it. Passing neither argument clears every tag.
        """
        body: dict[str, Any] = {}
        if tag_ids is not None:
            body["tagIds"] = list(tag_ids)
        if names is not None:
            body["names"] = list(names)
        payload = self._request("PUT", f"/documents/{document_id}/tags", json_body=body)
        return [Tag.from_payload(item) for item in payload or []]

    # -- transport -----------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Sequence[tuple[str, Any]] | None = None,
        json_body: Mapping[str, Any] | None = None,
        files: Mapping[str, Any] | None = None,
    ) -> Any:
        url = f"{self._base_url}{API_PREFIX}{path}"
        headers = dict(self._headers)
        if method not in _IDEMPOTENT_METHODS:
            headers["Idempotency-Key"] = str(uuid.uuid4())

        last_error: Exception | None = None
        for attempt in range(self._max_retries + 1):
            try:
                response = self._http.request(
                    method,
                    url,
                    params=params,
                    json=json_body,
                    files=files,
                    headers=headers,
                )
            except httpx.TransportError as exc:
                last_error = exc
                if attempt >= self._max_retries:
                    raise errors.ConnectionError(f"Could not reach {url}: {exc}") from exc
                time.sleep(_backoff(attempt))
                continue

            if response.status_code in _RETRY_STATUSES and attempt < self._max_retries:
                delay = _retry_delay(response, attempt)
                if delay is not None:
                    time.sleep(delay)
                    continue

            if response.status_code >= 400:
                raise _to_error(response)

            return _decode(response)

        raise errors.ConnectionError(f"Could not reach {url}: {last_error}")


def _backoff(attempt: int) -> float:
    """Exponential backoff with jitter.

    The jitter matters: without it every client retrying a shared outage wakes
    up at the same moment and pushes the service back over.
    """
    ceiling = min(_MAX_RETRY_DELAY, 0.5 * (2**attempt))
    return random.uniform(ceiling / 2, ceiling)


def _retry_delay(response: httpx.Response, attempt: int) -> float | None:
    """How long to wait before retrying, or ``None`` to give up now.

    A rate-limited response carries the delay the API wants; anything longer
    than the cap is reported to the caller instead of blocking the thread.
    """
    if response.status_code != 429:
        return _backoff(attempt)

    retry_after = _retry_after_seconds(response)
    if retry_after is None:
        return _backoff(attempt)
    if retry_after > _MAX_RETRY_DELAY:
        return None
    return retry_after


def _retry_after_seconds(response: httpx.Response) -> float | None:
    raw = response.headers.get("Retry-After")
    if not raw:
        return None
    try:
        return max(0.0, float(raw.strip()))
    except ValueError:
        return None


def _decode(response: httpx.Response) -> Any:
    if response.status_code == 204 or not response.content:
        return None
    try:
        return response.json()
    except ValueError as exc:
        raise errors.AutosignlyError(
            f"Expected JSON from {response.request.url}, got {response.headers.get('content-type')}",
            status_code=response.status_code,
        ) from exc


def _to_error(response: httpx.Response) -> errors.AutosignlyError:
    error_type = error_id = info = None
    try:
        body = response.json()
        if isinstance(body, dict):
            error_type = body.get("errorType")
            error_id = body.get("errorId")
            info = body.get("info")
    except ValueError:
        info = response.text[:200] or None

    status = response.status_code
    message = info or f"Request failed with status {status}"
    kwargs = {"status_code": status, "error_type": error_type, "error_id": error_id}

    if status == 401:
        return errors.AuthenticationError(message, **kwargs)
    if status == 403:
        return errors.PermissionDeniedError(message, **kwargs)
    if status == 404:
        return errors.NotFoundError(message, **kwargs)
    if status == 429:
        return errors.RateLimitError(message, retry_after=_retry_after_seconds(response), **kwargs)
    if status >= 500:
        return errors.ServerError(message, **kwargs)
    return errors.ValidationError(message, **kwargs)


def _to_page(payload: Any, factory: Any) -> Page[Any]:
    content = [factory(item) for item in (payload or {}).get("content") or []]
    info = (payload or {}).get("page") or {}
    return Page(
        content=content,
        number=info.get("number", 0),
        size=info.get("size", len(content)),
        total_elements=info.get("totalElements", len(content)),
        total_pages=info.get("totalPages", 1 if content else 0),
    )
