#!/usr/bin/env node
import { PRODUCTION_API_URL, parse, type ListenOptions } from "./config.js";
import { readProfile } from "./credentials.js";
import { listen } from "./listen.js";
import { login, logout } from "./login.js";

const USAGE = `autosignly - command line tool for Autosignly

Usage:
  autosignly login
  autosignly listen --forward-to <url>
  autosignly logout

Options:
  --forward-to <url>   Where to POST the events, for example localhost:8080/webhooks
  --api-url <url>      Defaults to ${PRODUCTION_API_URL}
  --ws-url <url>       Event stream address, when it is not on the API host
  --skip-verify        Forward without the signature headers
  --help               Show this message

Credentials come from "autosignly login", or from the AUTOSIGNLY_API_KEY
and AUTOSIGNLY_API_SECRET environment variables when there is no terminal, such
as on CI. Passing secrets as command line flags is not supported: they would be
recorded in your shell history and visible to every process on the machine.

Events are delivered over an outbound connection, so nothing on your machine
needs to be reachable from the internet.
`;


function required(flags: Map<string, string | boolean>, name: string, fallback?: string): string {
  const value = flags.get(name);
  if (typeof value === "string") {
    return value;
  }
  if (fallback) {
    return fallback;
  }
  throw new Error(`Missing --${name}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0]?.startsWith("--") ? undefined : argv[0];
  const flags = parse(command ? argv.slice(1) : argv);

  if (!command || command === "help" || flags.has("help")) {
    console.log(USAGE);
    return;
  }

  const apiUrl = required(flags, "api-url", process.env.AUTOSIGNLY_API_URL ?? PRODUCTION_API_URL);

  if (command === "login") {
    await login(apiUrl);
    return;
  }

  if (command === "logout") {
    logout(apiUrl);
    return;
  }

  if (command !== "listen") {
    throw new Error(`Unknown command "${command}". Run autosignly --help.`);
  }

  const stored = readProfile(apiUrl);
  const apiKey = process.env.AUTOSIGNLY_API_KEY ?? stored?.apiKey;
  const apiSecret = process.env.AUTOSIGNLY_API_SECRET ?? stored?.apiSecret;

  if (!apiKey || !apiSecret) {
    throw new Error('No credentials. Run "autosignly login" first, or set AUTOSIGNLY_API_KEY and AUTOSIGNLY_API_SECRET.');
  }

  const options: ListenOptions = {
    forwardTo: required(flags, "forward-to"),
    apiKey,
    apiSecret,
    apiUrl,
    wsUrl: typeof flags.get("ws-url") === "string"
      ? (flags.get("ws-url") as string)
      : process.env.AUTOSIGNLY_WS_URL,
    skipVerify: flags.get("skip-verify") === true,
  };

  await listen(options);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
