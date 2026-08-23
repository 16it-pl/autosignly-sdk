import { createRequire } from "node:module";

/**
 * The version of this package, read from its own package.json.
 *
 * Kept in one place on purpose: a constant written by hand drifts from the
 * manifest the moment a release bumps one and not the other, and then every
 * request reports a version nobody is running. The relative path resolves the
 * same from `dist/`, from `src/` and from the test build, all of which sit one
 * level below the package root, and npm always ships package.json.
 */
const manifest = createRequire(import.meta.url)("../package.json") as { version?: string };

export const VERSION: string = manifest.version ?? "unknown";
