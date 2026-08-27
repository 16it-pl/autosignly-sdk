import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

import { AutosignlyClient } from "./client.js";
import { VERSION } from "./version.js";
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

test("the User-Agent reports the version from package.json", async () => {
  const { client, calls } = buildClient(() => json({ valid: true }));

  await client.validateCredentials();

  // Read straight from the manifest: a constant written by hand would drift and
  // every request would then claim a version nobody is running.
  const manifest = createRequire(import.meta.url)("../package.json") as { version: string };
  assert.equal(calls[0].headers.get("user-agent"), `autosignly-node/${manifest.version}`);
  assert.equal(VERSION, manifest.version);
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
      content: [{ id: "d-1", name: "Umowa", status: "SIGNED", tags: [{ id: "t", name: "x" }] }],
      page: { number: 1, size: 5, totalElements: 6, totalPages: 2 },
    }),
  );

  const page = await client.listDocuments({ page: 1, size: 5, status: ["SIGNED", "GENERATED"] });

  assert.match(calls[0].url, /[?&]page=1&size=5&status=SIGNED&status=GENERATED$/);
  assert.equal(page.totalElements, 6);
  assert.equal(page.content[0].name, "Umowa");
  assert.equal(page.content[0].tags[0].name, "x");
});

test("listDocuments repeats the tag filter", async () => {
  const { client, calls } = buildClient(() =>
    json({ content: [], page: { number: 0, size: 20, totalElements: 0, totalPages: 0 } }),
  );

  await client.listDocuments({ tagId: ["tag-1", "tag-2"], status: "SIGNED" });

  assert.ok(calls[0].url.includes("tagId=tag-1"));
  assert.ok(calls[0].url.includes("tagId=tag-2"));
  assert.ok(calls[0].url.includes("status=SIGNED"));
});

test("listDocuments accepts a single tag", async () => {
  const { client, calls } = buildClient(() =>
    json({ content: [], page: { number: 0, size: 20, totalElements: 0, totalPages: 0 } }),
  );

  await client.listDocuments({ tagId: "tag-1" });

  assert.equal(calls[0].url.match(/tagId=/g)?.length, 1);
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

test("uploadPdf stores the document without sending it", async () => {
  const { client, calls } = buildClient(() => json({ documentId: "d-7" }));

  const documentId = await client.uploadPdf({
    pdf: new Uint8Array([37, 80, 68, 70]),
    documentName: "Umowa",
    fileName: "umowa.pdf",
  });

  assert.equal(documentId, "d-7");
  assert.ok(calls[0].url.endsWith("/documents"));
  const form = calls[0].body as FormData;
  const request = JSON.parse(await (form.get("request") as Blob).text());
  assert.deepEqual(request, { documentName: "Umowa" });
  assert.equal((form.get("file") as File).name, "umowa.pdf");
});

test("listAttachments parses the merge order", async () => {
  const { client, calls } = buildClient(() =>
    json([
      {
        id: "att-1",
        orderIndex: 0,
        fileName: "photo.jpg",
        format: "JPEG",
        sizeBytes: 482913,
        sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        pageCount: 1,
        status: "READY",
        fileUrl: "https://files.test/att-1.pdf",
      },
      { id: "att-2", orderIndex: 1, fileName: "annex.pdf", format: "PDF", status: "READY" },
    ]),
  );

  const attachments = await client.listAttachments("d-1");

  assert.ok(calls[0].url.endsWith("/documents/d-1/attachments"));
  assert.deepEqual(
    attachments.map((attachment) => attachment.id),
    ["att-1", "att-2"],
  );
  assert.deepEqual(
    attachments.map((attachment) => attachment.orderIndex),
    [0, 1],
  );
  assert.equal(attachments[0].pageCount, 1);
  assert.equal(attachments[0].sizeBytes, 482913);
  assert.equal(attachments[1].pageCount, undefined);
});

test("addAttachment posts the file as multipart", async () => {
  const { client, calls } = buildClient(() =>
    json({ id: "att-1", orderIndex: 0, fileName: "photo.jpg", status: "READY" }),
  );

  const attachment = await client.addAttachment("d-1", {
    content: new Uint8Array([255, 216, 255, 224]),
    fileName: "photo.jpg",
  });

  assert.equal(attachment.id, "att-1");
  assert.equal(calls[0].method, "POST");
  assert.ok(calls[0].url.endsWith("/documents/d-1/attachments"));
  const form = calls[0].body as FormData;
  assert.ok(form instanceof FormData);
  const file = form.get("file") as File;
  assert.equal(file.name, "photo.jpg");
  assert.equal(file.type, "image/jpeg");
  assert.equal(new Uint8Array(await file.arrayBuffer())[0], 255);
});

test("deleteAttachment targets the attachment", async () => {
  const { client, calls } = buildClient(() => new Response(null, { status: 204 }));

  await client.deleteAttachment("d-1", "att-1");

  assert.equal(calls[0].method, "DELETE");
  assert.ok(calls[0].url.endsWith("/documents/d-1/attachments/att-1"));
});

test("downloadAttachment follows the converted file link", async () => {
  const { client } = buildClient((call) =>
    call.url.endsWith("/attachments")
      ? json([{ id: "att-1", fileUrl: "https://files.test/att-1.pdf" }])
      : new Response(new Uint8Array([37, 80, 68, 70])),
  );

  const bytes = await client.downloadAttachment("d-1", "att-1");

  assert.deepEqual([...bytes], [37, 80, 68, 70]);
});

test("downloadAttachment reports an attachment that is not converted yet", async () => {
  const { client } = buildClient(() => json([{ id: "att-1", status: "FAILED" }]));

  await assert.rejects(() => client.downloadAttachment("d-1", "att-1"), NotFoundError);
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

const partyPayload = (overrides: Record<string, unknown> = {}) => ({
  id: "party-1",
  type: "COMPANY",
  name: "Acme Sp. z o.o.",
  taxId: "5842831253",
  email: "kontakt@acme.pl",
  phone: "+48500100200",
  createdAt: "2026-08-27T08:14:31Z",
  address: {
    street: "Marszalkowska",
    number: "12/34",
    postalCode: "00-001",
    city: "Warszawa",
    countryCode: "PL",
  },
  ...overrides,
});

test("listParties pages and filters", async () => {
  const { client, calls } = buildClient(() =>
    json({
      content: [partyPayload()],
      page: { number: 1, size: 50, totalElements: 101, totalPages: 3 },
    }),
  );

  const page = await client.listParties({ name: "acme", type: "COMPANY", page: 1, size: 50 });

  assert.ok(calls[0].url.startsWith(`${BASE}/publics/v1/parties?`));
  assert.ok(calls[0].url.includes("page=1"));
  assert.ok(calls[0].url.includes("size=50"));
  assert.ok(calls[0].url.includes("name=acme"));
  assert.ok(calls[0].url.includes("type=COMPANY"));
  assert.equal(page.content.length, 1);
  assert.equal(page.totalPages, 3);
  assert.equal(page.content[0].taxId, "5842831253");
  assert.equal(page.content[0].address?.postalCode, "00-001");
});

test("listParties without filters sends only paging", async () => {
  const { client, calls } = buildClient(() => json({ content: [], page: { number: 0, size: 20 } }));

  await client.listParties();

  assert.ok(!calls[0].url.includes("name="));
  assert.ok(!calls[0].url.includes("type="));
});

test("getParty reads a person", async () => {
  const { client, calls } = buildClient(() =>
    json(partyPayload({ id: "party-2", type: "PERSON", name: "Kowalski", firstname: "Jan", taxId: undefined, address: undefined })),
  );

  const party = await client.getParty("party-2");

  assert.equal(calls[0].url, `${BASE}/publics/v1/parties/party-2`);
  assert.equal(party.type, "PERSON");
  assert.equal(party.firstname, "Jan");
  assert.equal(party.taxId, undefined);
  assert.equal(party.address, undefined);
});

test("getParty on an unknown id throws NotFoundError", async () => {
  const { client } = buildClient(() => json({ errorType: "NOT_FOUND" }, 404));

  await assert.rejects(() => client.getParty("nope"), NotFoundError);
});

test("createParty sends the API field names", async () => {
  const { client, calls } = buildClient(() => json(partyPayload()));

  const created = await client.createParty({
    type: "COMPANY",
    name: "Acme Sp. z o.o.",
    taxId: "5842831253",
    email: "kontakt@acme.pl",
    address: {
      street: "Marszalkowska",
      number: "12/34",
      postalCode: "00-001",
      city: "Warszawa",
      countryCode: "PL",
    },
  });

  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${BASE}/publics/v1/parties`);
  assert.deepEqual(JSON.parse(calls[0].body as string), {
    type: "COMPANY",
    name: "Acme Sp. z o.o.",
    taxId: "5842831253",
    email: "kontakt@acme.pl",
    address: {
      street: "Marszalkowska",
      number: "12/34",
      postalCode: "00-001",
      city: "Warszawa",
      countryCode: "PL",
    },
  });
  assert.equal(created.id, "party-1");
});

test("createParty omits what was not set", async () => {
  const { client, calls } = buildClient(() => json(partyPayload()));

  await client.createParty({
    type: "PERSON",
    name: "Kowalski",
    firstname: "Jan",
    email: "jan@example.com",
  });

  assert.deepEqual(JSON.parse(calls[0].body as string), {
    type: "PERSON",
    name: "Kowalski",
    firstname: "Jan",
    email: "jan@example.com",
  });
});

test("updateParty replaces the whole party", async () => {
  const { client, calls } = buildClient(() => json(partyPayload({ name: "Acme Renamed" })));

  const updated = await client.updateParty("party-1", {
    type: "COMPANY",
    name: "Acme Renamed",
    taxId: "5842831253",
  });

  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].url, `${BASE}/publics/v1/parties/party-1`);
  const body = JSON.parse(calls[0].body as string);
  assert.equal(body.name, "Acme Renamed");
  assert.equal(body.id, undefined);
  assert.equal(updated.name, "Acme Renamed");
});

test("deleteParty resolves on 204", async () => {
  const { client, calls } = buildClient(() => new Response(null, { status: 204 }));

  await client.deleteParty("party-1");

  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].url, `${BASE}/publics/v1/parties/party-1`);
});

/**
 * A Node Buffer under 4 KB is a window onto the shared 8 KB allocation pool, so
 * `.buffer` is the whole pool rather than the file. Uploading that sent ~8 KB of
 * unrelated heap, starting with bytes that were not the file at all — the backend
 * rejected it, and it leaked whatever sat next to it in the pool. These pin the
 * uploaded part to exactly the bytes handed in.
 */
const POOLED = Buffer.from("%PDF-1.4\n" + "p".repeat(600));

async function uploadedFile(call: Call): Promise<Uint8Array> {
  const part = (call.body as FormData).get("file") as Blob;
  return new Uint8Array(await part.arrayBuffer());
}

test("uploadAndSign uploads exactly the bytes it was given, not the whole Buffer pool", async () => {
  const { client, calls } = buildClient(() => json({ documentId: "d-1" }));

  await client.uploadAndSign({
    pdf: POOLED,
    documentName: "Umowa",
    signers: [{ firstName: "A", lastName: "B", email: "a@b.test", country: "PL" }],
  });

  const sent = await uploadedFile(calls[0]);
  assert.equal(sent.byteLength, POOLED.byteLength);
  assert.deepEqual(Buffer.from(sent), POOLED);
});

test("uploadPdf uploads exactly the bytes it was given", async () => {
  const { client, calls } = buildClient(() => json({ documentId: "d-1" }));

  await client.uploadPdf({ pdf: POOLED, documentName: "Umowa" });

  const sent = await uploadedFile(calls[0]);
  assert.equal(sent.byteLength, POOLED.byteLength);
  assert.deepEqual(Buffer.from(sent), POOLED);
});

test("addAttachment uploads exactly the bytes it was given", async () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(700, 0x2a),
  ]);
  const { client, calls } = buildClient(() => json({ id: "a-1", fileName: "photo.png" }));

  await client.addAttachment("d-1", { content: png, fileName: "photo.png" });

  const sent = await uploadedFile(calls[0]);
  assert.equal(sent.byteLength, png.byteLength);
  // The backend detects the format from the leading magic bytes: a pooled upload
  // started with pool garbage instead and was rejected.
  assert.deepEqual(Buffer.from(sent.subarray(0, 8)), png.subarray(0, 8));
});

test("a subarray of a larger buffer uploads only its own window", async () => {
  const backing = Buffer.alloc(5000, 0x41);
  backing.write("%PDF-1.4", 1000);
  const view = backing.subarray(1000, 1600);
  const { client, calls } = buildClient(() => json({ documentId: "d-1" }));

  await client.uploadPdf({ pdf: view, documentName: "Umowa" });

  const sent = await uploadedFile(calls[0]);
  assert.equal(sent.byteLength, 600);
  assert.deepEqual(Buffer.from(sent), Buffer.from(view));
});

