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

export const EnvironmentType = {
  PROD: "PROD",
  SANDBOX: "SANDBOX",
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

export const AttachmentFormat = {
  PDF: "PDF",
  JPEG: "JPEG",
  PNG: "PNG",
} as const;

export const AttachmentStatus = {
  /** Converted to PDF and ready to be merged. */
  READY: "READY",
  /** Conversion failed; the attachment is skipped when the document is signed. */
  FAILED: "FAILED",
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

/** Whether a party is a business or a natural person. */
export const PartyType = {
  COMPANY: "COMPANY",
  PERSON: "PERSON",
} as const;

/** Registered address of a party. */
export interface PartyAddress {
  street?: string;
  number?: string;
  postalCode?: string;
  city?: string;
  /** ISO 3166-1 alpha-2, e.g. "PL". A Polish address makes the tax id subject to the NIP checksum. */
  countryCode?: string;
}

/**
 * A counterparty of the company — the other side of a document.
 *
 * A COMPANY is identified by `taxId` and needs an `address`; a PERSON needs a
 * `firstname` and an `email`. Parties belong to the environment of the key that
 * created them, so a sandbox key never sees a production party.
 */
export interface Party {
  type: string;
  name: string;
  firstname?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: PartyAddress;
  id?: string;
  createdAt?: string;
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

/** One signature type a signer from a given country may be asked for. */
export interface AllowedSignatureType {
  type?: string;
  /** Only for AES: how such a signer may confirm their identity. Empty for SES and QES. */
  verificationMethods: string[];
}

/**
 * What may be asked of a signer from one country.
 *
 * Sending a signer with a combination this policy does not list is rejected when
 * the document goes out, so read the policy before building your signer form.
 */
export interface SignaturePolicy {
  country?: string;
  /** True for the fallback entry, which covers every country without its own rules. */
  defaultPolicy: boolean;
  signatureTypes: AllowedSignatureType[];
}

/** A country an SMS verification code can be delivered to. */
export interface SmsCountry {
  countryCode?: string;
  name?: string;
  /** International dialing prefix the phone number has to start with, e.g. "+48". */
  dialingPrefix?: string;
}

/**
 * A file attached to a document.
 *
 * Attachments are converted to PDF and merged into the document when it is sent
 * for signing, behind an index page listing each one with its checksum, so a
 * single signature covers the document and everything attached to it.
 */
export interface Attachment {
  id: string;
  orderIndex: number;
  fileName?: string;
  format?: string;
  sizeBytes: number;
  sha256?: string;
  pageCount?: number;
  status?: string;
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

export function toPartyAddress(payload: Json): PartyAddress {
  return {
    street: str(payload.street),
    number: str(payload.number),
    postalCode: str(payload.postalCode),
    city: str(payload.city),
    countryCode: str(payload.countryCode),
  };
}

export function toParty(payload: Json): Party {
  const address = payload.address;
  return {
    type: String(payload.type ?? ""),
    name: String(payload.name ?? ""),
    firstname: str(payload.firstname),
    taxId: str(payload.taxId),
    email: str(payload.email),
    phone: str(payload.phone),
    address:
      address && typeof address === "object" ? toPartyAddress(address as Json) : undefined,
    id: str(payload.id),
    createdAt: str(payload.createdAt),
  };
}

export function partyToPayload(party: Party): Json {
  const payload: Json = { type: party.type, name: party.name };
  if (party.firstname !== undefined) payload.firstname = party.firstname;
  if (party.taxId !== undefined) payload.taxId = party.taxId;
  if (party.email !== undefined) payload.email = party.email;
  if (party.phone !== undefined) payload.phone = party.phone;
  if (party.address !== undefined) {
    const address: Json = {};
    if (party.address.street !== undefined) address.street = party.address.street;
    if (party.address.number !== undefined) address.number = party.address.number;
    if (party.address.postalCode !== undefined) address.postalCode = party.address.postalCode;
    if (party.address.city !== undefined) address.city = party.address.city;
    if (party.address.countryCode !== undefined) address.countryCode = party.address.countryCode;
    payload.address = address;
  }
  return payload;
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

export function toAllowedSignatureType(payload: Json): AllowedSignatureType {
  return {
    type: str(payload.type),
    verificationMethods: list(payload.verificationMethods).map(String),
  };
}

export function toSignaturePolicy(payload: Json): SignaturePolicy {
  return {
    country: str(payload.country),
    defaultPolicy: payload.defaultPolicy === true,
    signatureTypes: list(payload.signatureTypes).map(toAllowedSignatureType),
  };
}

export function toSmsCountry(payload: Json): SmsCountry {
  return {
    countryCode: str(payload.countryCode),
    name: str(payload.name),
    dialingPrefix: str(payload.dialingPrefix),
  };
}

export function toAttachment(payload: Json): Attachment {
  return {
    id: String(payload.id ?? ""),
    orderIndex: typeof payload.orderIndex === "number" ? payload.orderIndex : 0,
    fileName: str(payload.fileName),
    format: str(payload.format),
    sizeBytes: typeof payload.sizeBytes === "number" ? payload.sizeBytes : 0,
    sha256: str(payload.sha256),
    pageCount: typeof payload.pageCount === "number" ? payload.pageCount : undefined,
    status: str(payload.status),
    fileUrl: str(payload.fileUrl),
  };
}

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
