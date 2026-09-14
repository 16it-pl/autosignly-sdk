import { Client, type IMessage } from "@stomp/stompjs";
import { WebSocket } from "ws";

import {
  type Credentials,
  type ListenOptions,
  acknowledgementUrl,
  fetchCredentials,
  normaliseForwardTarget,
  websocketUrl,
} from "./config.js";

interface RelayFrame {
  eventType: string;
  timestamp: string;
  signature: string;
  /** The event body verbatim, exactly as it was signed. */
  payload: string | unknown;
  /**
   * Single-use token to report back with, when this relay is the whole delivery.
   *
   * Absent for an event that also goes out over HTTP: there the server's own
   * POST decides the outcome, and a listener merely watching it has nothing to
   * report. Holding the token is what proves we received this frame.
   */
  ackToken?: string;
}

export async function listen(options: ListenOptions): Promise<void> {
  const credentials = await fetchCredentials(options);
  if (!credentials.valid) {
    throw new Error("The API key and secret were rejected");
  }
  if (!credentials.environmentId) {
    throw new Error("This API key has no environment assigned");
  }

  announce(credentials, options);

  const destination = `/topic/webhooks/${credentials.environmentId}`;
  const target = normaliseForwardTarget(options.forwardTo);

  const client = new Client({
    webSocketFactory: () => new WebSocket(websocketUrl(options.apiUrl, options.wsUrl)) as unknown as never,
    connectHeaders: {
      "x-api-key": options.apiKey,
      "x-api-secret": options.apiSecret,
    },
    reconnectDelay: 2000,
    heartbeatIncoming: 10000,
    heartbeatOutgoing: 10000,
    onStompError: (frame) => {
      console.error(`Rejected by the server: ${frame.headers["message"] ?? "unknown reason"}`);
    },
    onWebSocketClose: () => {
      console.error("Connection lost, reconnecting...");
    },
    onConnect: () => {
      client.subscribe(destination, (message) => {
        void forward(message, target, options);
      });
      console.log(`Listening. Events will be forwarded to ${target}`);
    },
  });

  client.activate();

  await new Promise<void>((resolve) => {
    const stop = () => {
      console.log("\nStopping.");
      void client.deactivate().then(resolve);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

async function forward(message: IMessage, target: string, options: ListenOptions): Promise<void> {
  let frame: RelayFrame;
  try {
    frame = JSON.parse(message.body) as RelayFrame;
  } catch {
    console.error("Received a frame that is not valid JSON, ignoring it");
    return;
  }

  // Forward the body byte for byte. Re-serialising it would change the
  // formatting and the signature would no longer match at the receiver.
  const body = typeof frame.payload === "string" ? frame.payload : JSON.stringify(frame.payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!options.skipVerify) {
    headers["X-Webhook-Timestamp"] = frame.timestamp;
    headers["X-Webhook-Signature"] = frame.signature;
  }

  const started = Date.now();
  try {
    const response = await fetch(target, { method: "POST", headers, body });
    report(frame.eventType, response.status, Date.now() - started);
    await acknowledge(frame, options, { delivered: response.ok, httpStatus: response.status });
  } catch (error) {
    const reason = (error as Error).message;
    console.error(`${frame.eventType}  ->  could not reach ${target}: ${reason}`);
    await acknowledge(frame, options, { delivered: false, error: reason });
  }
}

/**
 * Tells Autosignly what became of an event only this listener could deliver.
 *
 * Without it the delivery list would have to guess, and guessing means claiming
 * a document reached a machine nobody could reach. A failure to report is
 * printed but never thrown: the event itself was already forwarded, and the
 * server closes anything it never hears about.
 */
async function acknowledge(
  frame: RelayFrame,
  options: ListenOptions,
  outcome: { delivered: boolean; httpStatus?: number; error?: string },
): Promise<void> {
  if (!frame.ackToken) {
    return;
  }

  try {
    const response = await fetch(acknowledgementUrl(options.apiUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": options.apiKey,
        "X-API-SECRET": options.apiSecret,
      },
      body: JSON.stringify({ ackToken: frame.ackToken, ...outcome }),
    });
    if (!response.ok) {
      console.error(`Could not report the outcome of ${frame.eventType}: server answered ${response.status}`);
    }
  } catch (error) {
    console.error(`Could not report the outcome of ${frame.eventType}: ${(error as Error).message}`);
  }
}

function report(eventType: string, status: number, tookMs: number): void {
  const mark = status >= 200 && status < 300 ? "ok " : "FAIL";
  console.log(`${mark} ${eventType}  ->  ${status}  (${tookMs} ms)`);
}

function announce(credentials: Credentials, options: ListenOptions): void {
  console.log(`Company     ${credentials.companyId}`);
  console.log(`Environment ${credentials.environmentId} (${credentials.environmentType})`);
  if (credentials.environmentType === "PROD") {
    console.log("");
    console.log("  WARNING: this key belongs to PRODUCTION.");
    console.log("  Real events from real customers will be forwarded to your machine.");
    console.log("");
  }
  console.log(`Forwarding  ${normaliseForwardTarget(options.forwardTo)}`);
}
