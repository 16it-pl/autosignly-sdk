/**
 * Contract test: every field name this client reads or sends must exist in the
 * published OpenAPI schema.
 *
 * The field lists are not written by hand — the parsers are called with a Proxy
 * that records which properties they touch. A parser that starts reading a
 * different key is therefore checked automatically, which is what a hand-kept
 * list would never do.
 *
 * This runs offline against `spec/autodocuments-v1.yaml`, so it needs no
 * environment and no network.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { parse as parseYaml } from "yaml";

import { AutosignlyClient } from "./client.js";
import {
  signerToPayload,
  toAttachment,
  toCredentials,
  toDocument,
  toDocumentSummary,
  toPage,
  toParty,
  toPartyAddress,
  partyToPayload,
  toSignerDetails,
  toSignerStatus,
  toSigningRequestResult,
  toTag,
} from "./models.js";

const SPEC_PATH = join(import.meta.dirname, "..", "..", "..", "spec", "autodocuments-v1.yaml");
const spec = parseYaml(readFileSync(SPEC_PATH, "utf8")) as {
  components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
};

function propertiesOf(schema: string): Set<string> {
  const found = spec.components.schemas[schema];
  assert.ok(found, `schema ${schema} is missing from the spec`);
  return new Set(Object.keys(found.properties ?? {}));
}

/** Run a parser against a recording proxy and report which keys it read. */
function keysReadBy(parser: (payload: never) => unknown): string[] {
  const seen = new Set<string>();
  const recorder = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "string") seen.add(property);
        return undefined;
      },
    },
  );
  parser(recorder as never);
  return [...seen];
}

const PARSERS: [string, string, (payload: never) => unknown][] = [
  ["toAttachment", "AttachmentResponse", toAttachment],
  ["toDocument", "DocumentInfoResponse", toDocument],
  ["toDocumentSummary", "DocumentListItemResponse", toDocumentSummary],
  ["toSignerDetails", "SignerResponse", toSignerDetails],
  ["toSignerStatus", "SignerStatusResponse", toSignerStatus],
  ["toCredentials", "CredentialsResponse", toCredentials],
  ["toSigningRequestResult", "SendForSigningResponse", toSigningRequestResult],
  ["toTag", "TagResponse", toTag],
  ["toParty", "Party", toParty],
  ["toPartyAddress", "PartyAddress", toPartyAddress],
];

for (const [name, schema, parser] of PARSERS) {
  test(`${name} only reads fields declared in ${schema}`, () => {
    const declared = propertiesOf(schema);
    const unknown = keysReadBy(parser).filter((key) => !declared.has(key));

    assert.deepEqual(unknown, [], `${name} reads fields the API does not send: ${unknown.join(", ")}`);
  });
}

test("toPage reads the envelope the API sends", () => {
  const envelope = propertiesOf("PageResponseDocumentListItemResponseV1");
  const unknown = keysReadBy((payload) => toPage(payload, () => null)).filter(
    (key) => !envelope.has(key),
  );

  assert.deepEqual(unknown, []);

  // The counters live one level down, in the nested page object.
  const info = propertiesOf("PageInfo");
  for (const counter of ["number", "size", "totalElements", "totalPages"]) {
    assert.ok(info.has(counter), `PageInfo lost ${counter}`);
  }
});

test("signerToPayload sends only fields the API accepts", () => {
  const declared = propertiesOf("ExternalSignerRequest");
  const sent = Object.keys(
    signerToPayload({
      firstName: "Anna",
      lastName: "Nowak",
      email: "anna@example.com",
      country: "PL",
      phoneNumber: "+48123456789",
      locale: "pl",
      order: 1,
      signatureType: "AES",
      signatureVerificationMethod: "SMS",
    }),
  );

  const unknown = sent.filter((key) => !declared.has(key));
  assert.deepEqual(unknown, [], `unknown signer fields: ${unknown.join(", ")}`);
});

test("partyToPayload sends only fields the API accepts", () => {
  const declared = propertiesOf("PartyRequest");
  const payload = partyToPayload({
    type: "COMPANY",
    name: "Acme Sp. z o.o.",
    firstname: "Jan",
    taxId: "5842831253",
    email: "kontakt@acme.pl",
    phone: "+48500100200",
    address: {
      street: "Marszalkowska",
      number: "12/34",
      postalCode: "00-001",
      city: "Warszawa",
      countryCode: "PL",
    },
  });

  const unknown = Object.keys(payload).filter((key) => !declared.has(key));
  assert.deepEqual(unknown, [], `unknown party fields: ${unknown.join(", ")}`);

  const address = propertiesOf("PartyAddress");
  const unknownAddress = Object.keys(payload.address as Record<string, unknown>).filter(
    (key) => !address.has(key),
  );
  assert.deepEqual(unknownAddress, []);
});

test("the party filters the client sends exist in the spec", () => {
  const parameters = (
    spec as unknown as {
      paths: Record<string, { get: { parameters: { name: string }[] } }>;
    }
  ).paths["/api/publics/v1/parties"].get.parameters;
  const declared = new Set(parameters.map((parameter) => parameter.name));

  for (const sent of ["name", "type", "page", "size"]) {
    assert.ok(declared.has(sent), `the API no longer accepts ${sent}`);
  }
});

test("uploadAndSign sends only fields the API accepts", async () => {
  let body: FormData | undefined;
  const client = new AutosignlyClient("k", "s", {
    baseUrl: "https://api.test/api",
    fetch: async (_url, init) => {
      body = init?.body as FormData;
      return new Response(JSON.stringify({ documentId: "d-1" }), {
        headers: { "content-type": "application/json" },
      });
    },
  });

  await client.uploadAndSign({
    pdf: new Uint8Array([37]),
    documentName: "Umowa",
    signatureType: "SES",
    signatureMode: "SIGNATURES_CARD",
    verificationMethod: "SMS",
    initiatorEmail: "initiator@example.com",
    signers: [{ firstName: "A", lastName: "B", email: "a@b.test", country: "PL" }],
  });

  const request = JSON.parse(await (body!.get("request") as Blob).text());
  const declared = propertiesOf("UploadPdfAndSignRequest");
  const unknown = Object.keys(request).filter((key) => !declared.has(key));
  assert.deepEqual(unknown, [], `unknown request fields: ${unknown.join(", ")}`);

  const initiator = propertiesOf("SigningInitiatorData");
  const unknownInitiator = Object.keys(request.signingInitiatorData).filter(
    (key) => !initiator.has(key),
  );
  assert.deepEqual(unknownInitiator, []);
});

test("the document filters the client sends exist in the spec", () => {
  const parameters = (
    spec as unknown as {
      paths: Record<string, { get: { parameters: { name: string }[] } }>;
    }
  ).paths["/api/publics/v1/documents"].get.parameters;
  const declared = new Set(parameters.map((parameter) => parameter.name));

  for (const sent of ["status", "tagId", "page", "size", "sort"]) {
    assert.ok(declared.has(sent), `the API no longer accepts ${sent}`);
  }
});

test("every endpoint the client calls exists in the spec", () => {
  const paths = new Set(Object.keys((spec as unknown as { paths: object }).paths));
  const called = [
    "/api/publics/v1/api-key",
    "/api/publics/v1/credentials",
    "/api/publics/v1/documents",
    "/api/publics/v1/documents/{documentId}",
    "/api/publics/v1/documents/{documentId}/attachments",
    "/api/publics/v1/documents/{documentId}/attachments/{attachmentId}",
    "/api/publics/v1/documents/signings",
    "/api/publics/v1/documents/{documentId}/signings",
    "/api/publics/v1/documents/{documentId}/tags",
    "/api/publics/v1/tags",
    "/api/publics/v1/tags/{tagId}",
    "/api/publics/v1/parties",
    "/api/publics/v1/parties/{partyId}",
  ];

  const missing = called.filter((path) => !paths.has(path));
  assert.deepEqual(missing, [], `endpoints gone from the API: ${missing.join(", ")}`);
});
