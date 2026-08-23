# autosignly-client

Java client for the [Autosignly](https://autosignly.eu) API: send documents for
eIDAS electronic signature, follow their status, download the sealed PDF, and
verify webhook deliveries.

HTTP comes from the JDK client, so the only dependency you inherit is Jackson.

```xml
<dependency>
  <groupId>eu.autosignly</groupId>
  <artifactId>autosignly-client</artifactId>
  <version>0.1.0</version>
</dependency>
```

Requires Java 17 or newer.

## Credentials

Create an API key and secret in the Autosignly application. Every environment,
production and each sandbox, has its own pair, and **the pair decides which
environment a call operates on** — a sandbox key can never touch production data.

The secret must never reach a browser or a mobile app. This client belongs on
your own server. Instances are immutable and safe to share between threads.

```java
var client = AutosignlyClient.of(System.getenv("AUTOSIGNLY_API_KEY"),
                                 System.getenv("AUTOSIGNLY_API_SECRET"));

var credentials = client.describeCredentials();
System.out.println(credentials.environmentType());  // "PROD" or "SANDBOX"
```

Checking this before the first call is worth the round trip: it is the only way
to be sure a key points where you think it does.

## Sending a document for signature

```java
String documentId = client.uploadAndSign(
        Files.readAllBytes(Path.of("contract.pdf")),
        "Rental agreement 2026",
        "contract.pdf",
        SigningOptions.of(List.of(
                Signer.of("Anna", "Nowak", "anna@example.com", "PL").withOrder(1),
                Signer.of("Jan", "Kowalski", "jan@example.com", "PL").withOrder(2)))
            .withSignature(SignatureType.SES, SignatureMode.SIGNATURES_CARD));
```

Signing links are e-mailed to the signers by Autosignly. The order is not
cosmetic: signers are notified one after another, and the next person receives
their link only once the previous one has signed.

## Following a document and downloading the result

```java
var document = client.getDocument(documentId);

if (DocumentStatus.SIGNED.equals(document.status())) {
    Files.write(Path.of("contract-signed.pdf"), client.downloadDocument(documentId));
}
```

`fileUrl()` on the document is a short-lived link — fetch the document again for
a fresh one rather than storing it. `downloadDocument` does that for you.

A document can be downloaded while signing is still in progress; it then carries
only the signatures collected so far.

## Attachments

Files attached to a document are converted to PDF and merged into it when it is
sent for signing, behind an index page listing each one with its checksum — so a
single signature covers the document and everything attached to it.

Attachments can only be added before the document is sent, so upload it first and
send it afterwards instead of using `uploadAndSign`:

```java
String documentId = client.uploadPdf(
        Files.readAllBytes(Path.of("protocol.pdf")), "Handover protocol", "protocol.pdf");

var attachment = client.addAttachment(
        documentId, Files.readAllBytes(Path.of("site-photo.jpg")), "site-photo.jpg");

for (var existing : client.listAttachments(documentId)) {
    System.out.println(existing.fileName() + " " + existing.orderIndex() + " " + existing.sha256());
}

client.sendForSigning(documentId, SigningOptions.of(signers));
```

An attachment can be dropped again while the document is still unsent:

```java
client.deleteAttachment(documentId, attachment.id());
```

PDF, JPEG and PNG are accepted, recognised from the content rather than the file
name. Attachments merge in the order they were added, and can only be changed
before the document is sent for signing.

## Listing

```java
var page = client.listDocuments(0, 50, List.of(DocumentStatus.SIGNED));

for (var summary : client.iterateDocuments(100, null)) {
    System.out.println(summary.id() + " " + summary.name());
}
```

`iterateDocuments` fetches pages as the iterator advances, so a large
environment never has to be held in memory at once.

Both calls have an overload taking tag ids. Several tags narrow the result — a
document has to carry all of them — and a tag that does not exist gives an empty
page rather than an error:

```java
var tagged = client.listDocuments(0, 50, List.of(DocumentStatus.SIGNED), List.of(tagId));
```

## Webhooks

Autosignly signs every delivery with `X-Webhook-Signature` and
`X-Webhook-Timestamp`. Verify it before trusting the body:

```java
@PostMapping("/webhooks/autosignly")
ResponseEntity<Void> receive(@RequestBody byte[] body,
                             @RequestHeader("X-Webhook-Signature") String signature,
                             @RequestHeader("X-Webhook-Timestamp") String timestamp) {

    if (!Webhooks.isValid(body, signature, webhookKey, timestamp)) {
        return ResponseEntity.status(401).build();
    }
    // ...
    return ResponseEntity.ok().build();
}
```

Two things decide whether this works:

**Verify the raw body.** The signature covers the exact bytes that were sent.
Binding the JSON to an object and re-serialising it changes them — take
`byte[]`, not a DTO.

**Deliveries expire.** Anything older than five minutes is rejected even when
the signature matches, so a captured request cannot be replayed later. Pass a
tolerance of `0` to opt out, for example when replaying a stored delivery in a
test.

During a key rotation Autosignly signs with both the new and the previous key
and sends both signatures in one header. `isValid` accepts either, so you can
swap your stored secret without dropping deliveries.

## Errors

Every failure is an `AutosignlyException` — unchecked, carrying the API's
`errorType()` and `errorId()`. Quote the latter when reporting a problem.

| class | when |
|---|---|
| `AutosignlyException.Authentication` | the key or secret was rejected (401) |
| `AutosignlyException.PermissionDenied` | valid credentials, no access to this resource (403) |
| `AutosignlyException.NotFound` | no such document, tag or file (404) |
| `AutosignlyException.Validation` | the request was rejected as invalid (4xx) |
| `AutosignlyException.RateLimit` | too many requests (429); `retryAfter()` holds the delay asked for |
| `AutosignlyException.Server` | the API failed to process the request (5xx) |
| `AutosignlyException.Connection` | the API could not be reached at all |
| `AutosignlyException.InvalidSignature` | a webhook signature did not match |

Transient failures — 429 and 5xx — are retried twice by default with
exponential backoff and jitter, honouring `Retry-After`. A rate limit asking for
longer than a minute is reported to you instead of blocking the thread. Build
with `.maxRetries(0)` to handle retries yourself.

Writes carry an `Idempotency-Key` header. The API does not act on it yet, so a
retried upload can still create a second document — until it does, treat a
timed-out `uploadAndSign` as "unknown" and check the document list before
sending again.

## License

Apache-2.0
