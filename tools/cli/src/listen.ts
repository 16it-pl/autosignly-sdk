import { Client, type IMessage } from "@stomp/stompjs";
import { WebSocket } from "ws";

import {
  type Credentials,
  type ListenOptions,
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
        void forward(message, target, options.skipVerify);
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

async function forward(message: IMessage, target: string, skipVerify: boolean): Promise<void> {
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
  if (!skipVerify) {
    headers["X-Webhook-Timestamp"] = frame.timestamp;
    headers["X-Webhook-Signature"] = frame.signature;
  }

  const started = Date.now();
  try {
    const response = await fetch(target, { method: "POST", headers, body });
    report(frame.eventType, response.status, Date.now() - started);
  } catch (error) {
    console.error(`${frame.eventType}  ->  could not reach ${target}: ${(error as Error).message}`);
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
