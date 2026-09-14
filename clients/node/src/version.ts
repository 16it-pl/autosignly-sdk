/**
 * The version of this package.
 *
 * A constant on purpose. Reading `package.json` at runtime through
 * `createRequire(import.meta.url)` breaks under every bundler that does not
 * preserve `import.meta.url` (esbuild, webpack, Rollup, and the Twenty app
 * builder among them): `createRequire` receives `undefined` and throws
 * "The argument 'filename' must be a file URL object, file URL string, or
 * absolute path string".
 *
 * Kept in step with package.json by `scripts/sync-version.mjs`, which runs on
 * `prepublishOnly` and is checked in CI.
 */
export const VERSION: string = "1.0.1-dev.0";
