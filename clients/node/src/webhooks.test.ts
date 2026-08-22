import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { InvalidSignatureError } from "./errors.js";
import { computeSignature, isValid, verify } from "./webhooks.js";

const SECRET = "wh_secret";
const BODY = Buffer.from('{"eventType":"DOCUMENT_SIGNED"}', "utf8");

const now = () => String(Math.floor(Date.now() / 1000));
const sign = (timestamp: string, secret = SECRET, body = BODY) =>
  createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), body]))
    .digest("hex");

test("computeSignature covers the timestamp and the body", () => {
  const timestamp = "1700000000";
  assert.equal(computeSignature(BODY, SECRET, timestamp), sign(timestamp));
});

test("accepts a delivery signed with the current key", () => {
  const timestamp = now();
  assert.equal(isValid(BODY, `v1=${sign(timestamp)}`, SECRET, timestamp), true);
});

test("accepts either signature while a key is being rotated", () => {
  const timestamp = now();
  const header = `v1=${sign(timestamp, "wh_old")},v1=${sign(timestamp)}`;

  assert.equal(isValid(BODY, header, SECRET, timestamp), true);
  assert.equal(isValid(BODY, header, "wh_old", timestamp), true);
});

test("rejects a body that changed by one byte", () => {
  const timestamp = now();
  const tampered = Buffer.from('{"eventType":"DOCUMENT_SIGNEE"}', "utf8");
  assert.equal(isValid(tampered, `v1=${sign(timestamp)}`, SECRET, timestamp), false);
});

test("rejects a wrong key", () => {
  const timestamp = now();
  assert.equal(isValid(BODY, `v1=${sign(timestamp)}`, "wh_other", timestamp), false);
});

test("rejects a replayed delivery outside the tolerance", () => {
  const old = String(Math.floor(Date.now() / 1000) - 600);
  assert.equal(isValid(BODY, `v1=${sign(old)}`, SECRET, old), false);
  assert.equal(isValid(BODY, `v1=${sign(old)}`, SECRET, old, { tolerance: 0 }), true);
});

test("rejects an unknown signature version", () => {
  const timestamp = now();
  assert.equal(isValid(BODY, `v2=${sign(timestamp)}`, SECRET, timestamp), false);
});

test("rejects missing input instead of throwing", () => {
  const timestamp = now();
  assert.equal(isValid(BODY, "", SECRET, timestamp), false);
  assert.equal(isValid(BODY, `v1=${sign(timestamp)}`, "", timestamp), false);
  assert.equal(isValid(BODY, `v1=${sign(timestamp)}`, SECRET, ""), false);
});

test("verify throws on a bad signature and stays quiet on a good one", () => {
  const timestamp = now();
  assert.throws(() => verify(BODY, "v1=deadbeef", SECRET, timestamp), InvalidSignatureError);
  verify(BODY, `v1=${sign(timestamp)}`, SECRET, timestamp);
});

test("accepts the body as a string as well as bytes", () => {
  const timestamp = now();
  const text = BODY.toString("utf8");
  assert.equal(isValid(text, `v1=${sign(timestamp)}`, SECRET, timestamp), true);
});
