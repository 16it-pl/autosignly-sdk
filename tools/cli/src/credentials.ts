import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";

export interface StoredProfile {
  apiKey: string;
  apiSecret: string;
  environmentId?: string;
  environmentType?: string;
}

interface CredentialsFile {
  profiles: Record<string, StoredProfile>;
}

export function credentialsPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "autosignly", "credentials.json");
}

export function readProfile(apiUrl: string): StoredProfile | undefined {
  const file = readFile();
  return file?.profiles[apiUrl];
}

export function writeProfile(apiUrl: string, profile: StoredProfile): string {
  const path = credentialsPath();
  const file = readFile() ?? { profiles: {} };
  file.profiles[apiUrl] = profile;

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function removeProfile(apiUrl: string): boolean {
  const path = credentialsPath();
  const file = readFile();
  if (!file?.profiles[apiUrl]) {
    return false;
  }

  delete file.profiles[apiUrl];
  if (Object.keys(file.profiles).length === 0) {
    rmSync(path, { force: true });
    return true;
  }
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  return true;
}

export async function prompt(question: string, hidden: boolean): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Cannot ask for credentials without a terminal. Set AUTOSIGNLY_API_KEY and AUTOSIGNLY_API_SECRET instead."
    );
  }
  return hidden ? readHidden(question) : readVisible(question);
}

async function readVisible(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function readHidden(question: string): Promise<string> {
  process.stdout.write(question);

  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let value = "";

    const finish = (action: () => void) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      process.stdout.write("\n");
      action();
    };

    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n" || character === "\u0004") {
          finish(() => resolve(value.trim()));
          return;
        }
        if (character === "\u0003") {
          finish(() => reject(new Error("Cancelled")));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function readFile(): CredentialsFile | undefined {
  const path = credentialsPath();
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CredentialsFile;
  } catch {
    return undefined;
  }
}
