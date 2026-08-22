import { type Credentials, type ListenOptions, fetchCredentials } from "./config.js";
import { prompt, removeProfile, writeProfile } from "./credentials.js";

export async function login(apiUrl: string): Promise<void> {
  console.log(`Signing in to ${apiUrl}`);
  console.log("Your API key and secret are created in the Autosignly application.");
  console.log("");

  const apiKey = await prompt("API key:    ", false);
  const apiSecret = await prompt("API secret: ", true);

  if (!apiKey || !apiSecret) {
    throw new Error("Both the key and the secret are required");
  }

  const credentials = await verify({ apiKey, apiSecret, apiUrl });

  const path = writeProfile(apiUrl, {
    apiKey,
    apiSecret,
    environmentId: credentials.environmentId ?? undefined,
    environmentType: credentials.environmentType ?? undefined,
  });

  console.log("");
  console.log(`Signed in to ${credentials.environmentType} environment ${credentials.environmentId}`);
  console.log(`Saved to ${path}`);
  if (credentials.environmentType === "PROD") {
    console.log("");
    console.log("  This key belongs to PRODUCTION. Consider using a sandbox key while developing.");
  }
}

export function logout(apiUrl: string): void {
  if (removeProfile(apiUrl)) {
    console.log(`Signed out of ${apiUrl}`);
    return;
  }
  console.log(`No stored credentials for ${apiUrl}`);
}

async function verify(partial: Pick<ListenOptions, "apiKey" | "apiSecret" | "apiUrl">): Promise<Credentials> {
  const credentials = await fetchCredentials({
    ...partial,
    forwardTo: "",
    skipVerify: false,
  });

  if (!credentials.valid) {
    throw new Error("The API key and secret were rejected, nothing was saved");
  }
  if (!credentials.environmentId) {
    throw new Error("This API key has no environment assigned, nothing was saved");
  }
  return credentials;
}
