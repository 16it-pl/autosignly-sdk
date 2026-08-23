# @16it/autosignly

Node.js client for the [Autosignly](https://autosignly.eu) API: send documents for
eIDAS electronic signature, follow their status, download the sealed PDF, and
verify webhook deliveries.

No runtime dependencies — it uses the `fetch` and `crypto` built into Node.

```bash
npm install @16it/autosignly
```

Requires Node 20 or newer.

## Credentials

Create an API key and secret in the Autosignly application. Every environment,
production and each sandbox, has its own pair, and **the pair decides which
environment a call operates on** — a sandbox key can never touch production data.

The secret must never reach a browser or a mobile app. This client belongs on
your own server.

```ts
import { AutosignlyClient } from "@16it/autosignly";

const client = new AutosignlyClient(
  process.env.AUTOSIGNLY_API_KEY!,
  process.env.AUTOSIGNLY_API_SECRET!,
);

const credentials = await client.describeCredentials();
console.log(credentials.environmentType); // "PROD" or "SANDBOX"
```

Checking this before the first call is worth the round trip: it is the only way
to be sure a key points where you think it does.

## Sending a document for signature

```ts
import { readFile } from "node:fs/promises";

const documentId = await client.uploadAndSign({
  pdf: await readFile("contract.pdf"),
  documentName: "Rental agreement 2026",
  fileName: "contract.pdf",
  signers: [
    { firstName: "Anna", lastName: "Nowak", email: "anna@example.com", country: "PL", order: 1 },
    { firstName: "Jan", lastName: "Kowalski", email: "jan@example.com", country: "PL", order: 2 },
  ],
});
```

Signing links are e-mailed to the signers by Autosignly. `order` is not
cosmetic: signers are notified one after another, and the next person receives
their link only once the previous one has signed.

Signing options default to a simple electronic signature (SES) with a visual
stamp. Pass `signatureType` and `signatureMode` to change that — for example
`signatureMode: "SIGNATURES_CARD"` collects signatures on a card appended to the
document instead of stamping its pages.

## Following a document and downloading the result

```ts
const document = await client.getDocument(documentId);
if (document.status === "SIGNED") {
  await writeFile("contract-signed.pdf", await client.downloadDocument(documentId));
}
```

`fileUrl` on the document is a short-lived link — fetch the document again for a
fresh one rather than storing it. `downloadDocument` does that for you.

A document can be downloaded while signing is still in progress; it then carries
only the signatures collected so far. Wait for `SIGNED` if you want the final,
sealed file.

## Attachments

Files attached to a document are converted to PDF and merged into it when it is
sent for signing, behind an index page listing each one with its checksum — so a
single signature covers the document and everything attached to it.

Attachments can only be added before the document is sent, so upload it first and
send it afterwards instead of using `uploadAndSign`:

```ts
const documentId = await client.uploadPdf({
  pdf: await readFile("protocol.pdf"),
  documentName: "Handover protocol",
});

const attachment = await client.addAttachment(documentId, {
  content: await readFile("site-photo.jpg"),
  fileName: "site-photo.jpg",
});

for (const existing of await client.listAttachments(documentId)) {
  console.log(existing.fileName, existing.orderIndex, existing.sha256);
}

await client.sendForSigning(documentId, { signers });
```

An attachment can be dropped again while the document is still unsent:

```ts
await client.deleteAttachment(documentId, attachment.id);
```

PDF, JPEG and PNG are accepted, recognised from the content rather than the file
name. Attachments merge in the order they were added, and can only be changed
before the document is sent for signing.

## Listing

```ts
const page = await client.listDocuments({ status: "SIGNED", size: 50 });

for await (const document of client.iterDocuments({ status: "SIGNED" })) {
  console.log(document.id, document.name);
}
```

`iterDocuments` fetches pages as the iterator advances, so a large environment
never has to be held in memory at once.

Both calls take `tagId` as well. Several tags narrow the result — a document has
to carry all of them — and a tag that does not exist gives an empty page rather
than an error:

```ts
const tagged = await client.listDocuments({ tagId: ["contracts", "2026"], status: "SIGNED" });
```

## Webhooks

Autosignly signs every delivery with `X-Webhook-Signature` and
`X-Webhook-Timestamp`. Verify it before trusting the body:

```ts
import express from "express";
import { webhooks } from "@16it/autosignly";

app.post("/webhooks/autosignly", express.raw({ type: "application/json" }), (req, res) => {
  const ok = webhooks.isValid(
    req.body,
    req.header("X-Webhook-Signature") ?? "",
    process.env.AUTOSIGNLY_WEBHOOK_KEY!,
    req.header("X-Webhook-Timestamp") ?? "",
  );
  if (!ok) return res.sendStatus(401);

  const event = JSON.parse(req.body.toString("utf8"));
  // ...
  res.sendStatus(200);
});
```

Two things decide whether this works:

**Verify the raw body.** The signature covers the exact bytes that were sent.
Parsing the JSON and re-serialising it changes them — hence `express.raw()`
rather than `express.json()`.

**Deliveries expire.** Anything older than five minutes is rejected even when
the signature matches, so a captured request cannot be replayed later. Pass
`{ tolerance: 0 }` to opt out, for example when replaying a stored delivery in a
test.

During a key rotation Autosignly signs with both the new and the previous key
and sends both signatures in one header. `isValid` accepts either, so you can
swap your stored secret without dropping deliveries.

## Errors

Every failure is an `AutosignlyError` subclass carrying the API's `errorType`
and `errorId` — quote the latter when reporting a problem.

| class | when |
|---|---|
| `AuthenticationError` | the key or secret was rejected (401) |
| `PermissionDeniedError` | valid credentials, no access to this resource (403) |
| `NotFoundError` | no such document, tag or file (404) |
| `ValidationError` | the request was rejected as invalid (4xx) |
| `RateLimitError` | too many requests (429); `retryAfter` holds the delay asked for |
| `ServerError` | the API failed to process the request (5xx) |
| `ConnectionError` | the API could not be reached at all |
| `InvalidSignatureError` | a webhook signature did not match |

Transient failures — 429 and 5xx — are retried twice by default with
exponential backoff and jitter, honouring `Retry-After`. A rate limit asking for
longer than a minute is reported to you instead of blocking. Set `maxRetries: 0`
to handle retries yourself.

Writes carry an `Idempotency-Key` header. The API does not act on it yet, so a
retried upload can still create a second document — until it does, treat a
timed-out `uploadAndSign` as "unknown" and check the document list before
sending again.

## License

Apache-2.0
