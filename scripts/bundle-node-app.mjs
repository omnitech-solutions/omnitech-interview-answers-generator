// Bundles a plain-Node app (one that runs `node dist/<entry>.js`) into one ESM
// file. Workspace sources import each other without a file extension, which
// `tsc` emits unchanged and plain Node ESM cannot load, so every app that
// Node runs directly ships a bundle instead of emitted modules.
//
// Workspace `@omnitech/*` packages are inlined. The npm packages the app's own
// package.json declares stay external, so a package with a native binary or
// its own assets (a CLI SDK, `ws`) is installed and loaded as it ships.
//
//   node ../../scripts/bundle-node-app.mjs src/main.ts dist/main.js
//
// Run from the app's directory; `esbuild` comes from that app's devDependencies.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// CommonJS packages that bundle in still call `require`; give them one.
const COMMONJS_BANNER =
  'import { createRequire as __createRequire } from "node:module";\n' +
  "globalThis.require ??= __createRequire(import.meta.url);";

/** The npm packages an app declares, which stay out of its bundle. */
export function declaredPackages(appDir) {
  const manifest = JSON.parse(
    readFileSync(join(appDir, "package.json"), "utf8"),
  );
  return Object.entries({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  })
    .filter(([, range]) => !String(range).startsWith("workspace:"))
    .map(([name]) => name);
}

/** Bundles `entry` into `outfile` (both relative to `appDir`). */
export async function bundleNodeApp({ appDir, entry, outfile }) {
  const { build } = createRequire(join(appDir, "package.json"))("esbuild");
  return build({
    absWorkingDir: appDir,
    entryPoints: [resolve(appDir, entry)],
    outfile: resolve(appDir, outfile),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: true,
    banner: { js: COMMONJS_BANNER },
    external: declaredPackages(appDir).flatMap((name) => [name, `${name}/*`]),
    logLevel: "warning",
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [entry, outfile] = process.argv.slice(2);
  if (!entry || !outfile) {
    console.error("usage: bundle-node-app.mjs <entry.ts> <outfile.js>");
    process.exit(2);
  }
  await bundleNodeApp({ appDir: process.cwd(), entry, outfile });
}
