/**
 * Verifying webhook deliveries from Autosignly.
 *
 * Every delivery carries `X-Webhook-Signature` and `X-Webhook-Timestamp`. The
 * signature is an HMAC-SHA256 over `timestamp + "." + body`, keyed with the
 * webhook key from the Autosignly application, hex-encoded and prefixed with
 * the signature version.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { InvalidSignatureError } from "./errors.js";

export const SIGNATURE_VERSION = "v1";

/** Deliveries older than this are rejected, so a captured request cannot be replayed. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export interface VerifyOptions {
  /** Seconds of clock skew to accept. Pass 0 to skip the freshness check. */
  tolerance?: number;
}

/** Return the hex digest Autosignly sends for this payload and timestamp. */
export function computeSignature(
  payload: Uint8Array | string,
  secret: string,
  timestamp: string,
): string {
  const body = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
  return createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), body]))
    .digest("hex");
}

/**
 * Check a delivery without throwing.
 *
 * `payload` must be the raw request body exactly as received. Parsing and
 * re-serialising the JSON changes the bytes and invalidates the signature — in
 * Express, reach for `express.raw()` rather than `express.json()`.
 *
 * The header may carry several signatures separated by commas: during a key
 * rotation Autosignly signs with both the new and the previous key, so a
 * delivery stays verifiable while you swap your stored secret.
 */
export function isValid(
  payload: Uint8Array | string,
  signatureHeader: string,
  secret: string,
  timestamp: string,
  options: VerifyOptions = {},
): boolean {
  if (!signatureHeader || !secret || !timestamp) return false;

  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE_SECONDS;
  if (tolerance && !isFresh(timestamp, tolerance)) return false;

  const expected = computeSignature(payload, secret, timestamp);
  for (const candidate of signatureHeader.split(",")) {
    const [version, digest] = splitOnce(candidate.trim(), "=");
    if (version === SIGNATURE_VERSION && digest && equals(digest, expected)) {
      return true;
    }
  }
  return false;
}

/** Check a delivery and throw {@link InvalidSignatureError} if it fails. */
export function verify(
  payload: Uint8Array | string,
  signatureHeader: string,
  secret: string,
  timestamp: string,
  options: VerifyOptions = {},
): void {
  if (!isValid(payload, signatureHeader, secret, timestamp, options)) {
    throw new InvalidSignatureError("Webhook signature does not match the payload");
  }
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const index = value.indexOf(separator);
  if (index === -1) return [value, undefined];
  return [value.slice(0, index), value.slice(index + separator.length)];
}

function equals(received: string, expected: string): boolean {
  // timingSafeEqual throws on a length mismatch, which would itself leak a bit
  // of information — compare lengths first and keep the constant-time path for
  // the case that matters.
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received, "utf8"), Buffer.from(expected, "utf8"));
}

function isFresh(timestamp: string, tolerance: number): boolean {
  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return false;
  return Math.abs(Date.now() / 1000 - sent) <= tolerance;
}
