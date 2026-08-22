/** Errors raised by the Autosignly client. */

export interface ErrorDetails {
  statusCode?: number;
  errorType?: string;
  errorId?: string;
}

/** Base class for every error raised by this library. */
export class AutosignlyError extends Error {
  readonly statusCode?: number;
  /** Machine-readable cause from the API, e.g. `INVALID_REQUEST`. */
  readonly errorType?: string;
  /** Correlation id — quote it when reporting a problem to support. */
  readonly errorId?: string;

  constructor(message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = new.target.name;
    this.statusCode = details.statusCode;
    this.errorType = details.errorType;
    this.errorId = details.errorId;
  }

  override toString(): string {
    const parts = [`${this.name}: ${this.message}`];
    if (this.errorType) parts.push(`type=${this.errorType}`);
    if (this.errorId) parts.push(`errorId=${this.errorId}`);
    return parts.join(" ");
  }
}

/** The API key or secret was rejected. */
export class AuthenticationError extends AutosignlyError {}

/** The credentials are valid but do not grant access to this resource. */
export class PermissionDeniedError extends AutosignlyError {}

/** The requested resource does not exist. */
export class NotFoundError extends AutosignlyError {}

/** The request was rejected as invalid. */
export class ValidationError extends AutosignlyError {}

/** Too many requests were sent in a short period. */
export class RateLimitError extends AutosignlyError {
  /** The delay the API asked for, in seconds, when it provided one. */
  readonly retryAfter?: number;

  constructor(message: string, details: ErrorDetails & { retryAfter?: number } = {}) {
    super(message, details);
    this.retryAfter = details.retryAfter;
  }
}

/** The API failed to process the request. */
export class ServerError extends AutosignlyError {}

/** The API could not be reached. */
export class ConnectionError extends AutosignlyError {}

/** A webhook signature did not match the payload. */
export class InvalidSignatureError extends AutosignlyError {}
