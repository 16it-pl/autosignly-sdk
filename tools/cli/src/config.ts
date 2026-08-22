export const PRODUCTION_API_URL = "https://app.autosignly.eu/api";

export interface ListenOptions {
  apiKey: string;
  apiSecret: string;
  forwardTo: string;
  apiUrl: string;
  wsUrl?: string;
  skipVerify: boolean;
}

export interface Credentials {
  valid: boolean;
  companyId: string | null;
  environmentId: string | null;
  environmentType: "PROD" | "SANDBOX" | null;
}

export function publicApiUrl(apiUrl: string, path: string): string {
  return `${apiUrl.replace(/\/$/, "")}/publics/v1${path}`;
}

export function websocketUrl(apiUrl: string, override?: string): string {
  if (override) {
    return override.replace(/^http/, "ws");
  }
  const base = apiUrl.replace(/\/$/, "").replace(/^http/, "ws");
  return `${base}/apimanagement/ws`;
}

export function normaliseForwardTarget(target: string): string {
  if (/^https?:\/\//.test(target)) {
    return target;
  }
  return `http://${target}`;
}

export async function fetchCredentials(options: ListenOptions): Promise<Credentials> {
  const response = await fetch(publicApiUrl(options.apiUrl, "/credentials"), {
    headers: {
      "X-API-KEY": options.apiKey,
      "X-API-SECRET": options.apiSecret,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not read credentials: HTTP ${response.status}`);
  }
  return (await response.json()) as Credentials;
}

export function parse(argv: string[]): Map<string, string | boolean> {
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    // Both spellings are common; --flag=value must not be read as a bare flag,
    // or the value is silently dropped and a default takes over.
    const equals = arg.indexOf("=");
    if (equals !== -1) {
      flags.set(arg.slice(2, equals), arg.slice(equals + 1));
      continue;
    }

    const name = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags.set(name, true);
    } else {
      flags.set(name, next);
      i++;
    }
  }
  return flags;
}
