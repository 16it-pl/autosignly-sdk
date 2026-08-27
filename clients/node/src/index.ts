/**
 * Node.js client for the Autosignly API.
 *
 *     import { AutosignlyClient } from "@16it/autosignly";
 *
 *     const client = new AutosignlyClient(process.env.AUTOSIGNLY_API_KEY!, process.env.AUTOSIGNLY_API_SECRET!);
 *     const documentId = await client.uploadAndSign({
 *       pdf: await readFile("contract.pdf"),
 *       documentName: "Contract",
 *       signers: [{ firstName: "Anna", lastName: "Nowak", email: "anna@example.com", country: "PL" }],
 *     });
 */

export { AutosignlyClient, PRODUCTION_BASE_URL } from "./client.js";
export type {
  ClientOptions,
  ListDocumentsOptions,
  SendForSigningOptions,
  UploadAndSignOptions,
} from "./client.js";
export {
  AutosignlyError,
  AuthenticationError,
  ConnectionError,
  InvalidSignatureError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "./errors.js";
export {
  AttachmentFormat,
  AttachmentStatus,
  DocumentStatus,
  EnvironmentType,
  PartyType,
  SignatureMode,
  SignatureType,
  SigningMode,
  SigningStatus,
  VerificationMethod,
} from "./models.js";
export type {
  Attachment,
  Credentials,
  Document,
  DocumentSummary,
  Page,
  Party,
  PartyAddress,
  Signer,
  SignerDetails,
  SignerStatus,
  SigningRequestResult,
  Tag,
} from "./models.js";
export * as webhooks from "./webhooks.js";
export { VERSION } from "./version.js";
