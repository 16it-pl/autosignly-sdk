/** HTTP client for the Autosignly public API. */

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import {
  AuthenticationError,
  AutosignlyError,
  ConnectionError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "./errors.js";
import {
  type Attachment,
  type Credentials,
  type Document,
  type DocumentSummary,
  type Page,
  type Signer,
  type SigningRequestResult,
  type Tag,
  signerToPayload,
  toAttachment,
  toCredentials,
  toDocument,
  toDocumentSummary,
  toPage,
  toSigningRequestResult,
  toTag,
} from "./models.js";
import { VERSION } from "./version.js";

export const PRODUCTION_BASE_URL = "https://app.autosignly.eu/api";
const API_PREFIX = "/publics/v1";

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_DELAY_SECONDS = 60;
const IDEMPOTENT_METHODS = new Set(["GET", "DELETE"]);

type Json = Record<string, unknown>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  baseUrl?: string;
  /** Per-request timeout in milliseconds. */
  timeout?: number;
  /** How many times to retry a failed request. Set 0 to disable. */
  maxRetries?: number;
  /** Injectable fetch, for tests or a custom agent. Defaults to global fetch. */
  fetch?: FetchLike;
}

export interface ListDocumentsOptions {
  page?: number;
  size?: number;
  /** One status or several — the endpoint repeats the parameter. */
  status?: string | string[];
  /**
   * One tag or several. Tags narrow the result: a document has to carry all of
   * them. A tag that does not exist yields an empty page rather than an error.
   */
  tagId?: string | string[];
}

export interface SendForSigningOptions {
  signers: Signer[];
  signatureType?: string;
  signatureMode?: string;
  verificationMethod?: string;
  initiatorEmail?: string;
  initiatorLocale?: string;
}

export interface UploadAndSignOptions extends SendForSigningOptions {
  pdf: Uint8Array;
  documentName: string;
  fileName?: string;
}

/**
 * Client for the Autosignly API.
 *
 * Credentials are a key and secret pair created in the Autosignly application.
 * Each environment, production or sandbox, has its own pair, and the pair
 * decides which environment a call operates on.
 *
 * The secret must never reach a browser or a mobile app. This client is meant
 * to run on your own server.
 */
export class AutosignlyClient {
  readonly #baseUrl: string;
  readonly #headers: Record<string, string>;
  readonly #timeout: number;
  readonly #maxRetries: number;
  readonly #fetch: FetchLike;

  constructor(apiKey: string, apiSecret: string, options: ClientOptions = {}) {
    if (!apiKey || !apiSecret) {
      throw new TypeError("apiKey and apiSecret are required");
    }

    this.#baseUrl = (options.baseUrl ?? PRODUCTION_BASE_URL).replace(/\/+$/, "");
    this.#timeout = options.timeout ?? 30_000;
    this.#maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#headers = {
      "X-API-KEY": apiKey,
      "X-API-SECRET": apiSecret,
      Accept: "application/json",
      "User-Agent": `autosignly-node/${VERSION}`,
    };
  }

  // -- credentials ---------------------------------------------------------

  /**
   * Report whether this key and secret pair is accepted.
   *
   * Invalid credentials return `false` rather than throwing, mirroring the API,
   * which never answers this call with an authentication error so that keys
   * cannot be probed.
   */
  async validateCredentials(): Promise<boolean> {
    const payload = await this.#request<Json>("GET", "/api-key");
    return Boolean(payload?.valid);
  }

  /**
   * Report which company and environment this key and secret resolve to.
   *
   * Useful before a first call: it says whether the pair points at production
   * or at a sandbox, without touching any document.
   */
  async describeCredentials(): Promise<Credentials> {
    return toCredentials((await this.#request<Json>("GET", "/credentials")) ?? {});
  }

  // -- documents -----------------------------------------------------------

  /** Return one page of documents belonging to this environment. */
  async listDocuments(options: ListDocumentsOptions = {}): Promise<Page<DocumentSummary>> {
    const params = new URLSearchParams({
      page: String(options.page ?? 0),
      size: String(options.size ?? 20),
    });
    for (const status of toArray(options.status)) params.append("status", status);
    for (const tagId of toArray(options.tagId)) params.append("tagId", tagId);

    const payload = await this.#request<Json>("GET", `/documents?${params}`);
    return toPage(payload, toDocumentSummary);
  }

  /**
   * Walk every document, page by page.
   *
   * Pages are fetched as the iterator advances, so a large environment does not
   * have to be held in memory at once.
   */
  async *iterDocuments(
    options: Omit<ListDocumentsOptions, "page"> = {},
  ): AsyncGenerator<DocumentSummary> {
    let page = 0;
    for (;;) {
      const result = await this.listDocuments({ ...options, page });
      for (const document of result.content) yield document;
      page += 1;
      if (page >= result.totalPages || result.content.length === 0) return;
    }
  }

  /** Return one document with its signers and a fresh link to its file. */
  async getDocument(documentId: string): Promise<Document> {
    return toDocument((await this.#request<Json>("GET", `/documents/${documentId}`)) ?? {});
  }

  /**
   * Fetch the current file of a document.
   *
   * Resolves a fresh link through {@link getDocument} and downloads it. A
   * document still being signed can be downloaded too; it then carries only the
   * signatures collected so far.
   */
  async downloadDocument(documentId: string): Promise<Uint8Array> {
    const document = await this.getDocument(documentId);
    if (!document.fileUrl) {
      throw new NotFoundError(`Document ${documentId} has no file to download`, {
        statusCode: 404,
      });
    }

    return this.#download(document.fileUrl, documentId);
  }

  /**
   * Store a PDF as a document without sending it to anyone.
   *
   * Returns the identifier of the created document. Use this when the document
   * needs attachments before it goes out: upload it, attach the files with
   * {@link addAttachment}, then call {@link sendForSigning}. A document that has
   * already been sent can no longer take attachments.
   */
  async uploadPdf(options: { pdf: Uint8Array; documentName: string; fileName?: string }): Promise<string> {
    const form = new FormData();
    // Copy into a fresh ArrayBuffer, for the same reason as in uploadAndSign.
    const pdf = options.pdf.slice().buffer;
    form.append("file", new Blob([pdf], { type: "application/pdf" }), options.fileName ?? "document.pdf");
    form.append(
      "request",
      new Blob([JSON.stringify({ documentName: options.documentName })], { type: "application/json" }),
    );

    const payload = await this.#request<Json>("POST", "/documents", { form });
    return String(payload?.documentId ?? "");
  }

  // -- attachments ---------------------------------------------------------

  /** Return the attachments of a document, in the order they will merge. */
  async listAttachments(documentId: string): Promise<Attachment[]> {
    const payload = await this.#request<Json[]>("GET", `/documents/${documentId}/attachments`);
    return (payload ?? []).map(toAttachment);
  }

  /**
   * Attach a file to a document that has not been sent for signing yet.
   *
   * The file is converted to PDF and merged into the document when it is sent,
   * behind an index page carrying its checksum, so one signature covers the
   * document and everything attached to it. PDF, JPEG and PNG are accepted,
   * recognised from the content rather than the file name. Attachments merge in
   * the order they were added.
   */
  async addAttachment(
    documentId: string,
    options: { content: Uint8Array; fileName: string },
  ): Promise<Attachment> {
    const form = new FormData();
    // Copy into a fresh ArrayBuffer, for the same reason as in uploadAndSign.
    const content = options.content.slice().buffer;
    form.append(
      "file",
      new Blob([content], { type: contentType(options.fileName) }),
      options.fileName,
    );

    const payload = await this.#request<Json>(
      "POST",
      `/documents/${documentId}/attachments`,
      { form },
    );
    return toAttachment(payload ?? {});
  }

  /** Remove an attachment from a document not yet sent for signing. */
  async deleteAttachment(documentId: string, attachmentId: string): Promise<void> {
    await this.#request<void>("DELETE", `/documents/${documentId}/attachments/${attachmentId}`);
  }

  /** Fetch one attachment converted to PDF — the rendition that gets merged. */
  async downloadAttachment(documentId: string, attachmentId: string): Promise<Uint8Array> {
    const attachment = (await this.listAttachments(documentId)).find(
      (candidate) => candidate.id === attachmentId,
    );
    if (!attachment) {
      throw new NotFoundError(`Document ${documentId} has no attachment ${attachmentId}`, {
        statusCode: 404,
      });
    }
    if (!attachment.fileUrl) {
      throw new NotFoundError(`Attachment ${attachmentId} is not converted yet`, {
        statusCode: 404,
      });
    }
    return this.#download(attachment.fileUrl, attachmentId);
  }

  /** Send an existing document to the given signers. */
  async sendForSigning(
    documentId: string,
    options: SendForSigningOptions,
  ): Promise<SigningRequestResult> {
    const payload = await this.#request<Json>(
      "POST",
      `/documents/${documentId}/signings`,
      { json: buildSigningRequest(options) },
    );
    return toSigningRequestResult(payload ?? {});
  }

  /**
   * Upload a PDF and send it for signature in one call.
   *
   * Returns the identifier of the created document. Signing links are e-mailed
   * to the signers directly.
   */
  async uploadAndSign(options: UploadAndSignOptions): Promise<string> {
    const request = buildSigningRequest(options);
    request.documentName = options.documentName;

    const form = new FormData();
    // Copy into a fresh ArrayBuffer: a Uint8Array view over a pooled Node buffer
    // can carry more bytes than the view itself, and Blob would upload all of it.
    const pdf = options.pdf.slice().buffer;
    form.append("file", new Blob([pdf], { type: "application/pdf" }), options.fileName ?? "document.pdf");
    form.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }));

    const payload = await this.#request<Json>("POST", "/documents/signings", { form });
    return String(payload?.documentId ?? "");
  }

  // -- tags ----------------------------------------------------------------

  /** Return one page of the company tag pool for this environment. */
  async listTags(options: { name?: string; page?: number; size?: number } = {}): Promise<Page<Tag>> {
    const params = new URLSearchParams({
      page: String(options.page ?? 0),
      size: String(options.size ?? 20),
    });
    if (options.name) params.set("name", options.name);

    const payload = await this.#request<Json>("GET", `/tags?${params}`);
    return toPage(payload, toTag);
  }

  /** Add a tag to the company pool, or return the existing one with that name. */
  async createTag(name: string): Promise<Tag> {
    return toTag((await this.#request<Json>("POST", "/tags", { json: { name } })) ?? {});
  }

  /** Remove a tag from the pool and from every document carrying it. */
  async deleteTag(tagId: string): Promise<void> {
    await this.#request<null>("DELETE", `/tags/${tagId}`);
  }

  /**
   * Replace the whole tag set of a document.
   *
   * Tags left out are removed. Names that are not in the pool yet are added to
   * it. Passing neither argument clears every tag.
   */
  async setDocumentTags(
    documentId: string,
    options: { tagIds?: string[]; names?: string[] } = {},
  ): Promise<Tag[]> {
    const body: Json = {};
    if (options.tagIds) body.tagIds = options.tagIds;
    if (options.names) body.names = options.names;

    const payload = await this.#request<Json[]>("PUT", `/documents/${documentId}/tags`, {
      json: body,
    });
    return (payload ?? []).map(toTag);
  }

  // -- transport -----------------------------------------------------------

  async #download(url: string, subject: string): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await this.#fetch(url, { signal: AbortSignal.timeout(this.#timeout) });
    } catch (cause) {
      throw new ConnectionError(`Could not download ${subject}: ${describe(cause)}`);
    }

    if (!response.ok) throw await toError(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  async #request<T>(
    method: string,
    path: string,
    body: { json?: Json; form?: FormData } = {},
  ): Promise<T | null> {
    const url = `${this.#baseUrl}${API_PREFIX}${path}`;
    const headers: Record<string, string> = { ...this.#headers };
    if (!IDEMPOTENT_METHODS.has(method)) {
      headers["Idempotency-Key"] = randomUUID();
    }
    if (body.json) headers["Content-Type"] = "application/json";

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method,
          headers,
          body: body.form ?? (body.json ? JSON.stringify(body.json) : undefined),
          signal: AbortSignal.timeout(this.#timeout),
        });
      } catch (cause) {
        lastError = cause;
        if (attempt >= this.#maxRetries) {
          throw new ConnectionError(`Could not reach ${url}: ${describe(cause)}`);
        }
        await sleep(backoff(attempt) * 1000);
        continue;
      }

      if (RETRY_STATUSES.has(response.status) && attempt < this.#maxRetries) {
        const delay = retryDelay(response, attempt);
        if (delay !== null) {
          await sleep(delay * 1000);
          continue;
        }
      }

      if (response.status >= 400) throw await toError(response);
      return (await decode(response)) as T | null;
    }

    throw new ConnectionError(`Could not reach ${url}: ${describe(lastError)}`);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

/** The server detects the real format from the bytes; this is only a hint. */
function contentType(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function buildSigningRequest(options: SendForSigningOptions): Json {
  const request: Json = { signers: options.signers.map(signerToPayload) };
  if (options.signatureType) request.signatureType = options.signatureType;
  if (options.signatureMode) request.signatureMode = options.signatureMode;
  if (options.verificationMethod) request.verificationMethod = options.verificationMethod;
  if (options.initiatorEmail) {
    request.signingInitiatorData = {
      email: options.initiatorEmail,
      locale: options.initiatorLocale ?? null,
    };
  }
  return request;
}

/**
 * Exponential backoff with jitter.
 *
 * The jitter matters: without it every client retrying a shared outage wakes up
 * at the same moment and pushes the service back over.
 */
function backoff(attempt: number): number {
  const ceiling = Math.min(MAX_RETRY_DELAY_SECONDS, 0.5 * 2 ** attempt);
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

/**
 * How long to wait before retrying, or `null` to give up now.
 *
 * A rate-limited response carries the delay the API wants; anything longer than
 * the cap is reported to the caller instead of blocking for a minute.
 */
function retryDelay(response: Response, attempt: number): number | null {
  if (response.status !== 429) return backoff(attempt);

  const retryAfter = retryAfterSeconds(response);
  if (retryAfter === undefined) return backoff(attempt);
  if (retryAfter > MAX_RETRY_DELAY_SECONDS) return null;
  return retryAfter;
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get("Retry-After");
  if (!raw) return undefined;
  const seconds = Number(raw.trim());
  return Number.isFinite(seconds) ? Math.max(0, seconds) : undefined;
}

async function decode(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new AutosignlyError(
      `Expected JSON from ${response.url}, got ${response.headers.get("content-type")}`,
      { statusCode: response.status },
    );
  }
}

async function toError(response: Response): Promise<AutosignlyError> {
  let errorType: string | undefined;
  let errorId: string | undefined;
  let info: string | undefined;

  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as Json;
    errorType = typeof body.errorType === "string" ? body.errorType : undefined;
    errorId = typeof body.errorId === "string" ? body.errorId : undefined;
    info = typeof body.info === "string" ? body.info : undefined;
  } catch {
    info = text.slice(0, 200) || undefined;
  }

  const status = response.status;
  const message = info ?? `Request failed with status ${status}`;
  const details = { statusCode: status, errorType, errorId };

  if (status === 401) return new AuthenticationError(message, details);
  if (status === 403) return new PermissionDeniedError(message, details);
  if (status === 404) return new NotFoundError(message, details);
  if (status === 429) {
    return new RateLimitError(message, { ...details, retryAfter: retryAfterSeconds(response) });
  }
  if (status >= 500) return new ServerError(message, details);
  return new ValidationError(message, details);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
