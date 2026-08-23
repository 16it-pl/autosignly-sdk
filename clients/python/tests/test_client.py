import json

import httpx
import pytest

from autosignly import (
    NotFoundError,
    RateLimitError,
    AuthenticationError,
    AutosignlyClient,
    PermissionDeniedError,
    Signer,
    ValidationError,
)

KEY = "api_key_test"
SECRET = "api_sct_test"


def build_client(handler, **kwargs):
    transport = httpx.MockTransport(handler)
    return AutosignlyClient(
        KEY,
        SECRET,
        base_url="https://api.test/api",
        http_client=httpx.Client(transport=transport),
        **kwargs,
    )


def test_describe_credentials_reports_the_environment():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "valid": True,
                "companyId": "co-1",
                "environmentId": "env-1",
                "environmentType": "SANDBOX",
            },
        )

    with build_client(handler) as client:
        credentials = client.describe_credentials()

    assert seen["url"] == "https://api.test/api/publics/v1/credentials"
    assert credentials.valid is True
    assert credentials.company_id == "co-1"
    assert credentials.environment_type == "SANDBOX"


def test_sends_credentials_as_headers():
    seen = {}

    def handler(request):
        seen["key"] = request.headers.get("X-API-KEY")
        seen["secret"] = request.headers.get("X-API-SECRET")
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"valid": True})

    with build_client(handler) as client:
        assert client.validate_credentials() is True

    assert seen["key"] == KEY
    assert seen["secret"] == SECRET
    assert seen["url"] == "https://api.test/api/publics/v1/api-key"


def test_invalid_credentials_do_not_raise():
    def handler(request):
        return httpx.Response(200, json={"valid": False})

    with build_client(handler) as client:
        assert client.validate_credentials() is False


def test_list_documents_parses_page_and_sends_filters():
    seen = {}

    def handler(request):
        seen["params"] = request.url.params.multi_items()
        return httpx.Response(
            200,
            json={
                "content": [
                    {"id": "doc-1", "name": "Contract", "status": "SIGNED", "tags": [{"id": "t1", "name": "hr"}]}
                ],
                "page": {"number": 0, "size": 20, "totalElements": 1, "totalPages": 1},
            },
        )

    with build_client(handler) as client:
        page = client.list_documents(status=["SIGNED", "GENERATED"], size=20)

    assert len(page) == 1
    assert page.content[0].id == "doc-1"
    assert page.content[0].tags[0].name == "hr"
    assert page.has_next is False
    assert ("status", "SIGNED") in seen["params"]
    assert ("status", "GENERATED") in seen["params"]


def test_iter_documents_follows_pages():
    pages = {
        "0": {
            "content": [{"id": "doc-1"}],
            "page": {"number": 0, "size": 1, "totalElements": 2, "totalPages": 2},
        },
        "1": {
            "content": [{"id": "doc-2"}],
            "page": {"number": 1, "size": 1, "totalElements": 2, "totalPages": 2},
        },
    }

    def handler(request):
        return httpx.Response(200, json=pages[request.url.params.get("page")])

    with build_client(handler) as client:
        found = [doc.id for doc in client.iter_documents(size=1)]

    assert found == ["doc-1", "doc-2"]


def test_get_document_parses_signers():
    def handler(request):
        return httpx.Response(
            200,
            json={
                "id": "doc-1",
                "name": "Contract",
                "companyId": "company-1",
                "status": "WAITING_FOR_SIGNATURE",
                "signerResponses": [{"email": "anna@example.com", "firstName": "Anna", "signingOrder": 1}],
            },
        )

    with build_client(handler) as client:
        document = client.get_document("doc-1")

    assert document.status == "WAITING_FOR_SIGNATURE"
    assert document.signers[0].email == "anna@example.com"
    assert document.signers[0].signing_order == 1


def test_upload_and_sign_posts_multipart_with_json_part():
    seen = {}

    def handler(request):
        seen["content_type"] = request.headers.get("content-type", "")
        seen["body"] = request.content
        seen["idempotency"] = request.headers.get("Idempotency-Key")
        return httpx.Response(200, json={"documentId": "doc-9"})

    signer = Signer(first_name="Anna", last_name="Nowak", email="anna@example.com", country="PL")

    with build_client(handler) as client:
        document_id = client.upload_and_sign(
            pdf=b"%PDF-1.4 fake",
            document_name="Contract",
            signers=[signer],
            signature_type="SES",
        )

    assert document_id == "doc-9"
    assert seen["content_type"].startswith("multipart/form-data")
    assert b"application/pdf" in seen["body"]
    assert b"application/json" in seen["body"]
    assert b"Contract" in seen["body"]
    assert seen["idempotency"]


def test_upload_pdf_stores_the_document_without_sending_it():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["body"] = request.content
        return httpx.Response(200, json={"documentId": "doc-7"})

    with build_client(handler) as client:
        document_id = client.upload_pdf(pdf=b"%PDF-1.4 fake", document_name="Umowa", file_name="umowa.pdf")

    assert document_id == "doc-7"
    assert seen["url"].endswith("/documents")
    assert b'name="request"' in seen["body"]
    assert b"Umowa" in seen["body"]
    assert b"signers" not in seen["body"]


def test_list_attachments_parses_the_merge_order():
    payload = [
        {
            "id": "att-1",
            "orderIndex": 0,
            "fileName": "photo.jpg",
            "format": "JPEG",
            "sizeBytes": 482913,
            "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            "pageCount": 1,
            "status": "READY",
            "fileUrl": "https://files.example/att-1.pdf",
        },
        {"id": "att-2", "orderIndex": 1, "fileName": "annex.pdf", "format": "PDF", "status": "READY"},
    ]
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        return httpx.Response(200, json=payload)

    with build_client(handler) as client:
        attachments = client.list_attachments("doc-1")

    assert seen["url"].endswith("/documents/doc-1/attachments")
    assert [a.id for a in attachments] == ["att-1", "att-2"]
    assert [a.order_index for a in attachments] == [0, 1]
    assert attachments[0].file_name == "photo.jpg"
    assert attachments[0].page_count == 1
    assert attachments[0].sha256.startswith("9f86d081")
    assert attachments[1].page_count is None


def test_add_attachment_posts_the_file_as_multipart():
    seen = {}

    def handler(request):
        seen["method"] = request.method
        seen["url"] = str(request.url)
        seen["content_type"] = request.headers.get("content-type", "")
        seen["body"] = request.content
        return httpx.Response(200, json={"id": "att-1", "orderIndex": 0, "fileName": "photo.jpg"})

    with build_client(handler) as client:
        attachment = client.add_attachment("doc-1", content=b"\xff\xd8\xff fake jpeg", file_name="photo.jpg")

    assert attachment.id == "att-1"
    assert seen["method"] == "POST"
    assert seen["url"].endswith("/documents/doc-1/attachments")
    assert seen["content_type"].startswith("multipart/form-data")
    assert b'name="file"' in seen["body"]
    assert b"image/jpeg" in seen["body"]
    assert b"fake jpeg" in seen["body"]


def test_delete_attachment_targets_the_attachment():
    seen = {}

    def handler(request):
        seen["method"] = request.method
        seen["url"] = str(request.url)
        return httpx.Response(204)

    with build_client(handler) as client:
        client.delete_attachment("doc-1", "att-1")

    assert seen["method"] == "DELETE"
    assert seen["url"].endswith("/documents/doc-1/attachments/att-1")


def test_download_attachment_follows_the_converted_file_url():
    def handler(request):
        if request.url.path.endswith("/attachments"):
            return httpx.Response(
                200,
                json=[{"id": "att-1", "fileUrl": "https://files.example/att-1.pdf"}],
            )
        return httpx.Response(200, content=b"%PDF converted")

    with build_client(handler) as client:
        assert client.download_attachment("doc-1", "att-1") == b"%PDF converted"


def test_download_attachment_before_conversion_raises():
    def handler(request):
        return httpx.Response(200, json=[{"id": "att-1", "status": "FAILED"}])

    with build_client(handler) as client:
        with pytest.raises(NotFoundError):
            client.download_attachment("doc-1", "att-1")


def test_signer_payload_omits_empty_fields():
    payload = Signer(
        first_name="Anna", last_name="Nowak", email="anna@example.com", country="PL"
    ).to_payload()

    assert payload == {
        "firstName": "Anna",
        "lastName": "Nowak",
        "email": "anna@example.com",
        "country": "PL",
    }


def test_set_document_tags_replaces_whole_set():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=[{"id": "t1", "name": "hr", "color": "#eee"}])

    with build_client(handler) as client:
        tags = client.set_document_tags("doc-1", tag_ids=["t1"], names=["new"])

    assert seen["body"] == {"tagIds": ["t1"], "names": ["new"]}
    assert tags[0].name == "hr"


@pytest.mark.parametrize(
    "status,expected",
    [(401, AuthenticationError), (403, PermissionDeniedError), (400, ValidationError)],
)
def test_maps_status_codes_to_errors(status, expected):
    def handler(request):
        return httpx.Response(
            status,
            json={"errorType": "INVALID_REQUEST", "errorId": "abc", "info": "boom"},
        )

    with build_client(handler) as client:
        with pytest.raises(expected) as raised:
            client.get_document("doc-1")

    assert raised.value.status_code == status
    assert raised.value.error_type == "INVALID_REQUEST"
    assert raised.value.error_id == "abc"


def test_retries_server_errors_then_succeeds():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503, json={})
        return httpx.Response(200, json={"valid": True})

    with build_client(handler, max_retries=1) as client:
        assert client.validate_credentials() is True

    assert calls["n"] == 2


def test_does_not_retry_client_errors():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(400, json={"errorType": "INVALID_REQUEST"})

    with build_client(handler, max_retries=2) as client:
        with pytest.raises(ValidationError):
            client.get_document("doc-1")

    assert calls["n"] == 1


def test_document_exposes_file_url():
    def handler(request):
        return httpx.Response(
            200,
            json={"id": "doc-1", "fileUrl": "https://files.test/doc-1.pdf"},
        )

    with build_client(handler) as client:
        document = client.get_document("doc-1")

    assert document.file_url == "https://files.test/doc-1.pdf"


def test_download_document_follows_the_file_url():
    def handler(request):
        if request.url.path.endswith("/documents/doc-1"):
            return httpx.Response(200, json={"id": "doc-1", "fileUrl": "https://files.test/doc-1.pdf"})
        return httpx.Response(200, content=b"%PDF-1.4 signed")

    with build_client(handler) as client:
        content = client.download_document("doc-1")

    assert content.startswith(b"%PDF")


def test_download_document_without_a_file_raises():
    def handler(request):
        return httpx.Response(200, json={"id": "doc-1"})

    with build_client(handler) as client:
        with pytest.raises(NotFoundError):
            client.download_document("doc-1")


def test_retries_rate_limits_using_retry_after():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "0"}, json={})
        return httpx.Response(200, json={"valid": True})

    with build_client(handler, max_retries=1) as client:
        assert client.validate_credentials() is True

    assert calls["n"] == 2


def test_gives_up_when_retry_after_is_longer_than_the_cap():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(429, headers={"Retry-After": "3600"}, json={})

    with build_client(handler, max_retries=2) as client:
        with pytest.raises(RateLimitError) as raised:
            client.validate_credentials()

    assert calls["n"] == 1
    assert raised.value.retry_after == 3600


def test_rate_limit_error_without_header_has_no_retry_after():
    def handler(request):
        return httpx.Response(429, json={})

    with build_client(handler, max_retries=0) as client:
        with pytest.raises(RateLimitError) as raised:
            client.validate_credentials()

    assert raised.value.retry_after is None


def test_sends_a_versioned_user_agent():
    seen = {}

    def handler(request):
        seen["ua"] = request.headers.get("User-Agent")
        return httpx.Response(200, json={"valid": True})

    with build_client(handler) as client:
        client.validate_credentials()

    assert seen["ua"].startswith("autosignly-python/")
