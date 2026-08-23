# autosignly

Python client for the [Autosignly](https://autosignly.eu) API - eIDAS electronic signatures and
document workflows.

> **Not published yet.** This package is being built. Install from source for now.

## Install

```bash
pip install autosignly
```

Requires Python 3.10 or newer.

## Quickstart

```python
from autosignly import AutosignlyClient, Signer

with AutosignlyClient(api_key="api_key_...", api_secret="api_sct_...") as client:
    document_id = client.upload_and_sign(
        pdf=open("contract.pdf", "rb").read(),
        document_name="Consulting agreement",
        signers=[
            Signer(
                first_name="Anna",
                last_name="Nowak",
                email="anna@example.com",
                country="PL",
            )
        ],
    )
    print(document_id)
```

The key and secret decide which environment you are working in. Every environment, production or
sandbox, has its own pair, so pointing a script at the sandbox is a matter of swapping credentials.

The secret must stay on your server. It must never be shipped to a browser or a mobile app.

## Reading documents

```python
document = client.get_document(document_id)
print(document.status, [s.email for s in document.signers])

for summary in client.iter_documents(status="SIGNED"):
    print(summary.id, summary.name)
```

## Downloading the file

A document carries a short-lived link to its file. The link expires, so fetch the document again
for a fresh one rather than storing it.

```python
document = client.get_document(document_id)
print(document.file_url)

pdf = client.download_document(document_id)
open("signed.pdf", "wb").write(pdf)
```

A document that is still being signed can be downloaded as well - it then carries only the
signatures collected so far.

## Attachments

Files attached to a document are converted to PDF and merged into it when it is sent for
signing, behind an index page listing each one with its checksum — so a single signature
covers the document and everything attached to it.

Attachments can only be added before the document is sent, so upload it first and send it
afterwards instead of using `upload_and_sign`:

```python
document_id = client.upload_pdf(
    pdf=open("protocol.pdf", "rb").read(),
    document_name="Handover protocol",
)

attachment = client.add_attachment(
    document_id,
    content=open("site-photo.jpg", "rb").read(),
    file_name="site-photo.jpg",
)
print(attachment.order_index, attachment.sha256)

for existing in client.list_attachments(document_id):
    print(existing.file_name, existing.page_count)

client.send_for_signing(document_id, signers=[signer])
```

An attachment can be dropped again while the document is still unsent:

```python
client.delete_attachment(document_id, attachment.id)
```

PDF, JPEG and PNG are accepted, recognised from the content rather than the file name.
Attachments merge in the order they were added, and can only be changed before the document
is sent for signing.

## Tags

```python
tag = client.create_tag("contracts")
client.set_document_tags(document_id, tag_ids=[tag.id], names=["2026"])
```

Setting tags replaces the whole set: tags left out are removed, and names that do not exist yet are
added to the company tag pool.

## Verifying webhooks

Autosignly signs every delivery. Check the signature against the raw request body, before parsing
it - re-serialising the JSON changes the bytes and the signature will not match.

```python
from autosignly import webhooks

webhooks.verify(
    request.body,
    request.headers["X-Webhook-Signature"],
    webhook_key,
    request.headers["X-Webhook-Timestamp"],
)
```

The signature covers the timestamp as well as the body, and a delivery older than five minutes is
rejected even when its signature matches, so a captured request cannot be replayed later.

While a webhook key is being rotated a delivery carries several signatures; it is accepted when any
of them matches, so rotation needs no change on your side.

`verify` raises `InvalidSignatureError` on a mismatch; `webhooks.is_valid(...)` returns a boolean
instead.

## Errors

Every failure raises a subclass of `AutosignlyError` carrying the HTTP status and the error type
returned by the API.

```python
from autosignly import AutosignlyError, NotFoundError

try:
    client.get_document("does-not-exist")
except NotFoundError:
    ...
except AutosignlyError as error:
    print(error.status_code, error.error_type, error.error_id)
```

Connection problems and server errors are retried automatically, with an exponential backoff and
jitter. Client errors are not retried, since repeating a rejected request cannot change its outcome.

Rate limits are retried too, honouring the delay the API asks for. When that delay is longer than a
minute the call fails instead of blocking your thread, and `RateLimitError.retry_after` tells you
how long to wait.

The client does not implement a circuit breaker. It runs inside your process, on calls you asked
for, so refusing to even attempt one would be surprising - and your own infrastructure is the right
place for that policy. Pass your own `http_client` if you want to add one.

## Links

- Website: <https://autosignly.eu>
- API documentation: <https://docs.16it.eu/docs/intro/>
- Source and issues: <https://github.com/16it-pl/autosignly-sdk>

## License

Apache-2.0
