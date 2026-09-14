import assert from "node:assert/strict";
import { test } from "node:test";

import { acknowledgementUrl, normaliseForwardTarget, parse, publicApiUrl, websocketUrl } from "./config.js";

test("builds public API paths under the versioned prefix", () => {
  assert.equal(
    publicApiUrl("https://app.autosignly.eu/api", "/credentials"),
    "https://app.autosignly.eu/api/publics/v1/credentials",
  );
});

test("tolerates a trailing slash on the API address", () => {
  assert.equal(
    publicApiUrl("https://app.autosignly.eu/api/", "/credentials"),
    "https://app.autosignly.eu/api/publics/v1/credentials",
  );
});

test("derives the event stream from the API address", () => {
  assert.equal(
    websocketUrl("https://app.autosignly.eu/api"),
    "wss://app.autosignly.eu/api/apimanagement/ws",
  );
});

test("an explicit stream address wins over the derived one", () => {
  // Deployed environments serve the stream under the API host; locally it runs
  // on its own port, and only the override can express that.
  assert.equal(
    websocketUrl("http://localhost:9692/api", "http://localhost:9192/api/apimanagement/ws"),
    "ws://localhost:9192/api/apimanagement/ws",
  );
});

test("keeps an already-websocket override untouched", () => {
  assert.equal(
    websocketUrl("http://localhost:9692/api", "ws://localhost:9192/api/apimanagement/ws"),
    "ws://localhost:9192/api/apimanagement/ws",
  );
});

test("the acknowledgement endpoint is not part of the published API", () => {
  // /publics/v1 is the contract integrators are given. Reporting on a delivery
  // only the CLI could make is not one of the things they may do.
  assert.equal(
    acknowledgementUrl("https://app.autosignly.eu/api"),
    "https://app.autosignly.eu/api/apimanagement/public/webhook-deliveries/acknowledged",
  );
  assert.equal(
    acknowledgementUrl("https://app.autosignly.eu/api/"),
    "https://app.autosignly.eu/api/apimanagement/public/webhook-deliveries/acknowledged",
  );
});

test("assumes plain http for a bare forward target", () => {
  assert.equal(normaliseForwardTarget("localhost:8000/hook"), "http://localhost:8000/hook");
  assert.equal(normaliseForwardTarget("https://example.test/hook"), "https://example.test/hook");
});

test("reads both --flag value and --flag=value", () => {
  const flags = parse(["--api-url=http://localhost:9692/api", "--forward-to", "http://x/y", "--skip-verify"]);

  assert.equal(flags.get("api-url"), "http://localhost:9692/api");
  assert.equal(flags.get("forward-to"), "http://x/y");
  assert.equal(flags.get("skip-verify"), true);
});
