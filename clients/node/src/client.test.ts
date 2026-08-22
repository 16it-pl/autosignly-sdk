import assert from "node:assert/strict";
import { test } from "node:test";

import { AutosignlyClient } from "./client.js";
import { AuthenticationError, NotFoundError, RateLimitError, ValidationError } from "./errors.js";

const KEY = "api_key_test";
const SECRET = "api_sct_test";
const BASE = "https://api.test/api";

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body?: unknown;
}

function buildClient(handler: (call: Call) => Response | Promise<Response>, maxRetries = 0) {
  const calls: Call[] = [];
  const client = new AutosignlyClient(KEY, SECRET, {
    baseUrl: BASE,
    maxRetries,
    fetch: async (url, init) => {
      const call: Call = {
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: init?.body,
      };
      calls.push(call);
      return handler(call);
    },
  });
  return { client, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

test("sends the credentials as headers", async () => {
  const { client, calls } = buildClient(() => json({ valid: true }));

  assert.equal(await client.validateCredentials(), true);
  assert.equal(calls[0].url, "https://api.test/api/publics/v1/api-key");
  assert.equal(calls[0].headers.get("X-API-KEY"), KEY);
  assert.equal(calls[0].headers.get("X-API-SECRET"), SECRET);
});

test("invalid credentials do not throw", async () => {
  const { client } = buildClient(() => json({ valid: false }));
  assert.equal(await client.validateCredentials(), false);
});

test("describeCredentials reports the environment", async () => {
  const { client, calls } = buildClient(() =>
    json({ valid: true, companyId: "co-1", environmentId: "env-1", environmentType: "SANDBOX" }),
  );

  const credentials = await client.describeCredentials();

  assert.equal(calls[0].url, "https://api.test/api/publics/v1/credentials");
  assert.equal(credentials.companyId, "co-1");
  assert.equal(credentials.environmentType, "SANDBOX");
});

test("listDocuments parses the page and sends the filters", async () => {
  const { client, calls } = buildClient(() =>
    json({
      content: [{ id: "d-1", documentName: "Umowa", status: "SIGNED", tags: [{ id: "t", name: "x" }] }],
      page: { number: 1, size: 5, totalElements: 6, totalPages: 2 },
    }),
  );

  const page = await client.listDocuments({ page: 1, size: 5, status: ["SIGNED", "GENERATED"] });

  assert.match(calls[0].url, /page=1&size=5&status=SIGNED&status=GENERATED$/);
  assert.equal(page.totalElements, 6);
  assert.equal(page.content[0].name, "Umowa");
  assert.equal(page.content[0].tags[0].name, "x");
});

test("iterDocuments follows the pages", async () => {
  let call = 0;
  const { client } = buildClient(() => {
    const page = call++;
    return json({
      content: [{ id: `d-${page}` }],
      page: { number: page, size: 1, totalElements: 2, totalPages: 2 },
    });
  });

  const ids: string[] = [];
  for await (const document of client.iterDocuments()) ids.push(document.id);

  assert.deepEqual(ids, ["d-0", "d-1"]);
});

test("getDocument parses signers and the file link", async () => {
  const { client } = buildClient(() =>
    json({
      id: "d-1",
      status: "SIGNED",
      fileUrl: "https://files.test/d-1.pdf",
      signerResponses: [{ email: "anna@example.com", signingOrder: 1, country: "PL" }],
    }),
  );

  const document = await client.getDocument("d-1");

  assert.equal(document.fileUrl, "https://files.test/d-1.pdf");
  assert.equal(document.signers[0].email, "anna@example.com");
  assert.equal(document.signers[0].signingOrder, 1);
});

test("sendForSigning returns the signing link of the first signer", async () => {
  // The document detail and the signing result carry different signer shapes:
  // signerResponses describe the people, signers describe where each one stands.
  const { client } = buildClient(() =>
    json({
      documentId: "d-1",
      status: "WAITING_FOR_SIGNATURE",
      signers: [
        { email: "anna@example.com", status: "AWAITING_SIGNATURE", signUrl: "https://sign.test/a", expiresAt: "2026-09-01T10:00:00Z" },
        { email: "jan@example.com", status: "SENT" },
      ],
    }),
  );

  const result = await client.sendForSigning("d-1", {
    signers: [{ firstName: "Anna", lastName: "Nowak", email: "anna@example.com", country: "PL" }],
  });

  assert.equal(result.signers[0].signUrl, "https://sign.test/a");
  assert.equal(result.signers[0].expiresAt, "2026-09-01T10:00:00Z");
  assert.equal(result.signers[1].signUrl, undefined);
});

test("downloadDocument resolves a fresh link and fetches the bytes", async () => {
  const { client, calls } = buildClient((call) =>
    call.url.endsWith("/documents/d-1")
      ? json({ id: "d-1", fileUrl: "https://files.test/d-1.pdf" })
      : new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }),
  );

  const bytes = await client.downloadDocument("d-1");

  assert.equal(calls[1].url, "https://files.test/d-1.pdf");
  assert.deepEqual([...bytes], [37, 80, 68, 70]);
});

test("downloadDocument reports a document with no file", async () => {
  const { client } = buildClient(() => json({ id: "d-1" }));
  await assert.rejects(() => client.downloadDocument("d-1"), NotFoundError);
});

test("uploadAndSign posts the pdf and the request as multipart", async () => {
  const { client, calls } = buildClient(() => json({ documentId: "d-9" }));

  const documentId = await client.uploadAndSign({
    pdf: new Uint8Array([37, 80, 68, 70]),
    documentName: "Umowa",
    fileName: "umowa.pdf",
    signatureType: "SES",
    signatureMode: "SIGNATURES_CARD",
    signers: [{ firstName: "Anna", lastName: "Nowak", email: "a@example.com", country: "PL", order: 1 }],
  });

  assert.equal(documentId, "d-9");
  const form = calls[0].body as FormData;
  assert.ok(form instanceof FormData);
  const request = JSON.parse(await (form.get("request") as Blob).text());
  assert.equal(request.documentName, "Umowa");
  assert.equal(request.signatureMode, "SIGNATURES_CARD");
  assert.equal(request.signers[0].order, 1);
  assert.equal((form.get("file") as File).name, "umowa.pdf");
});

test("a write carries an idempotency key, a read does not", async () => {
  const { client, calls } = buildClient(() => json({ id: "t-1", name: "Umowy" }));

  await client.createTag("Umowy");
  await client.listTags();

  assert.match(calls[0].headers.get("Idempotency-Key") ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(calls[1].headers.get("Idempotency-Key"), null);
});

test("setDocumentTags replaces the whole set", async () => {
  const { client, calls } = buildClient(() => json([{ id: "t-1", name: "CISO" }]));

  const tags = await client.setDocumentTags("d-1", { names: ["CISO", "policy"] });

  assert.equal(calls[0].method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].body as string).names, ["CISO", "policy"]);
  assert.equal(tags[0].name, "CISO");
});

test("maps status codes onto typed errors", async () => {
  for (const [status, expected] of [
    [401, AuthenticationError],
    [404, NotFoundError],
    [400, ValidationError],
  ] as const) {
    const { client } = buildClient(() => json({ errorType: "X", errorId: "e-1", info: "nope" }, status));
    await assert.rejects(() => client.getDocument("d-1"), expected);
  }
});

test("keeps the API error details on the exception", async () => {
  const { client } = buildClient(() =>
    json({ errorType: "INVALID_REQUEST", errorId: "e-7", info: "bad signer" }, 400),
  );

  await assert.rejects(
    () => client.getDocument("d-1"),
    (error: ValidationError) => {
      assert.equal(error.errorType, "INVALID_REQUEST");
      assert.equal(error.errorId, "e-7");
      assert.equal(error.message, "bad signer");
      return true;
    },
  );
});

test("a rate limit asking for longer than the cap is reported, not slept off", async () => {
  const { client, calls } = buildClient(() => json({}, 429, { "Retry-After": "600" }), 2);

  await assert.rejects(
    () => client.getDocument("d-1"),
    (error: RateLimitError) => {
      assert.equal(error.retryAfter, 600);
      return true;
    },
  );
  assert.equal(calls.length, 1, "must not retry when the wait exceeds the cap");
});

test("retries a server error and returns the eventual success", async () => {
  let call = 0;
  const { client, calls } = buildClient(() => (call++ === 0 ? json({}, 503) : json({ id: "d-1" })), 2);

  const document = await client.getDocument("d-1");

  assert.equal(document.id, "d-1");
  assert.equal(calls.length, 2);
});

test("reports an unreachable API as a connection error", async () => {
  const { client } = buildClient(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(() => client.getDocument("d-1"), /Could not reach/);
});
