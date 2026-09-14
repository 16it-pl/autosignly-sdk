// Keeps src/version.ts in step with package.json.
//
// The version used to be read from package.json at runtime, which broke every
// bundler that drops `import.meta.url`. It is a constant now, so something has
// to keep the two honest; this runs on prepublishOnly and in CI with --check.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const packagePath = join(here, "..", "package.json");
const versionPath = join(here, "..", "src", "version.ts");

const { version } = JSON.parse(readFileSync(packagePath, "utf8"));
const source = readFileSync(versionPath, "utf8");
const current = source.match(/export const VERSION: string = "([^"]+)"/)?.[1];

if (current === version) {
  process.exit(0);
}

if (process.argv.includes("--check")) {
  console.error(
    `src/version.ts says ${current}, package.json says ${version}. Run "npm run sync-version".`,
  );
  process.exit(1);
}

writeFileSync(
  versionPath,
  source.replace(
    /export const VERSION: string = "[^"]+"/,
    `export const VERSION: string = "${version}"`,
  ),
);
console.log(`src/version.ts updated to ${version}`);
