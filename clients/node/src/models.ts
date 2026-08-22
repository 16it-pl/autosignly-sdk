/**
 * Data types returned by and passed to the Autosignly API.
 *
 * Status and type values are plain strings rather than string-literal unions on
 * purpose: the API may gain new values over time, and a client that fails on an
 * unknown value would break on a server-side addition. The constants below list
 * the values known at the time of release, for convenience and autocompletion.
 */

export const SignatureType = {
  /** Qualified — the strongest, backed by a qualified certificate. */
  QES: "QES",
  /** Advanced — identity verified by SMS or a bank login. */
  AES: "AES",
  /** Simple — the default. */
  SES: "SES",
} as const;

export const VerificationMethod = {
  SMS: "SMS",
  /** Bank or national identity provider. */
  WK: "WK",
} as const;

export const SignatureMode = {
  /** The signer places a visual stamp on the document. */
  STAMP: "STAMP",
  /** Signatures are collected on a card appended to the document. */
  SIGNATURES_CARD: "SIGNATURES_CARD",
} as const;

export const SigningMode = {
  REQUIRES_SIGNATURE: "REQUIRES_SIGNATURE",
  ALREADY_SIGNED: "ALREADY_SIGNED",
  NO_SIGNATURE: "NO_SIGNATURE",
} as const;

export const DocumentStatus = {
  GENERATED: "GENERATED",
  SIGNERS_ASSIGNED: "SIGNERS_ASSIGNED",
  WAITING_FOR_SIGNATURE: "WAITING_FOR_SIGNATURE",
  SIGNING_IN_PROGRESS: "SIGNING_IN_PROGRESS",
  /** Every signature is in and the closing seal has been applied. */
  SIGNED: "SIGNED",
  CANCELLED: "CANCELLED",
} as const;

export const SigningStatus = {
  SENT: "SENT",
  AWAITING_SIGNATURE: "AWAITING_SIGNATURE",
  SIGNED: "SIGNED",
  REJECTED: "REJECTED",
} as const;

/** A person asked to sign a document. */
export interface Signer {
  firstName: string;
  lastName: string;
  email: string;
  /** ISO 3166-1 alpha-2, e.g. "PL". Decides the applicable signature policy. */
  country: string;
  /** E.164, e.g. "+48123456789". Required for AES with SMS verification. */
  phoneNumber?: string;
  /** BCP 47 tag for the signing UI shown to this signer. */
  locale?: string;
  /** Signing order, starting at 1. Signers are notified one after another. */
  order?: number;
  signatureType?: string;
  signatureVerificationMethod?: string;
}

/** Which company and environment a key and secret pair resolves to. */
export interface Credentials {
  valid: boolean;
  companyId?: string;
  environmentId?: string;
  /** "PROD" or "SANDBOX". */
  environmentType?: string;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
}

/** A signer as recorded on a document. */
export interface SignerDetails {
  email?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  locale?: string;
  country?: string;
  signatureType?: string;
  signatureVerificationMethod?: string;
  /** Position in the signing order, starting at 1. */
  signingOrder?: number;
}

/**
 * Where a signer stands, and the link they were given.
 *
 * Only the first signer still to sign carries `signUrl` — the next person gets
 * theirs once the previous one has signed.
 */
export interface SignerStatus {
  email?: string;
  status?: string;
  signUrl?: string;
  /** When `signUrl` stops working. Absent when there is no link. */
  expiresAt?: string;
}

/**
 * Full details of a document, including its signers and a link to its file.
 *
 * `fileUrl` is short-lived. Fetch the document again for a fresh link rather
 * than storing it. A document still being signed can be downloaded as well; it
 * then carries only the signatures collected so far.
 */
export interface Document {
  id: string;
  name?: string;
  companyId?: string;
  status?: string;
  signingMode?: string;
  signers: SignerDetails[];
  tags: Tag[];
  fileUrl?: string;
}

/** A document as it appears in a list — no signers, no file link. */
export interface DocumentSummary {
  id: string;
  name?: string;
  status?: string;
  signingMode?: string;
  createdAt?: string;
  tags: Tag[];
}

/** One page of a listing. */
export interface Page<T> {
  content: T[];
  number: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

/** The outcome of sending an existing document for signature. */
export interface SigningRequestResult {
  documentId?: string;
  status?: string;
  signers: SignerStatus[];
}

type Json = Record<string, unknown>;

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export function toTag(payload: Json): Tag {
  return {
    id: String(payload.id ?? ""),
    name: String(payload.name ?? ""),
    color: str(payload.color),
  };
}

export function toSignerDetails(payload: Json): SignerDetails {
  return {
    email: str(payload.email),
    firstName: str(payload.firstName),
    lastName: str(payload.lastName),
    phoneNumber: str(payload.phoneNumber),
    locale: str(payload.locale),
    country: str(payload.country),
    signatureType: str(payload.signatureType),
    signatureVerificationMethod: str(payload.signatureVerificationMethod),
    signingOrder:
      typeof payload.signingOrder === "number" ? payload.signingOrder : undefined,
  };
}

export function toSignerStatus(payload: Json): SignerStatus {
  return {
    email: str(payload.email),
    status: str(payload.status),
    signUrl: str(payload.signUrl),
    expiresAt: str(payload.expiresAt),
  };
}

const list = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

export function toDocument(payload: Json): Document {
  return {
    id: String(payload.id ?? ""),
    name: str(payload.name),
    companyId: str(payload.companyId),
    status: str(payload.status),
    signingMode: str(payload.signingMode),
    signers: list(payload.signerResponses).map(toSignerDetails),
    tags: list(payload.tags).map(toTag),
    fileUrl: str(payload.fileUrl),
  };
}

export function toDocumentSummary(payload: Json): DocumentSummary {
  return {
    id: String(payload.id ?? ""),
    name: str(payload.name),
    status: str(payload.status),
    signingMode: str(payload.signingMode),
    createdAt: str(payload.createdAt),
    tags: list(payload.tags).map(toTag),
  };
}

export function toCredentials(payload: Json): Credentials {
  return {
    valid: Boolean(payload.valid),
    companyId: str(payload.companyId),
    environmentId: str(payload.environmentId),
    environmentType: str(payload.environmentType),
  };
}

export function toSigningRequestResult(payload: Json): SigningRequestResult {
  return {
    documentId: str(payload.documentId),
    status: str(payload.status),
    signers: list(payload.signers).map(toSignerStatus),
  };
}

export function toPage<T>(payload: Json | null, factory: (item: Json) => T): Page<T> {
  const content = list(payload?.content).map(factory);
  const info = (payload?.page ?? {}) as Json;
  return {
    content,
    number: Number(info.number ?? 0),
    size: Number(info.size ?? content.length),
    totalElements: Number(info.totalElements ?? content.length),
    totalPages: Number(info.totalPages ?? (content.length > 0 ? 1 : 0)),
  };
}

export function signerToPayload(signer: Signer): Json {
  const payload: Json = {
    firstName: signer.firstName,
    lastName: signer.lastName,
    email: signer.email,
    country: signer.country,
  };
  if (signer.phoneNumber) payload.phoneNumber = signer.phoneNumber;
  if (signer.locale) payload.locale = signer.locale;
  if (signer.order !== undefined) payload.order = signer.order;
  if (signer.signatureType) payload.signatureType = signer.signatureType;
  if (signer.signatureVerificationMethod) {
    payload.signatureVerificationMethod = signer.signatureVerificationMethod;
  }
  return payload;
}
