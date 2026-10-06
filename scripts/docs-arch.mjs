// Runs Crux's derive-arch for bionic/arch with the project's data-model
// extractor enabled (tools/crux/arch/drizzle_data_model.py, wired in
// .bionic.yml). Crux ignores a per-repo extractor unless
// CRUX_ARCH_ALLOW_OVERRIDES=1, and then regenerates data-model as a stub, which
// shows as false drift; this wrapper sets it (default on; see .env.example). A raw derive-arch,
// audit-docs or check-drift run must export the flag too; if drift appears with
// the flag unset, re-run `pnpm docs:arch`. scripts/arch-extractor.test.ts fails
// when the committed data-model page is a stub.
//   pnpm docs:arch          regenerate bionic/arch
//   pnpm docs:arch:check    --dry-run: report drift, write nothing
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { withAside } from "./docs-arch-aside.mjs";

const root = resolve(import.meta.dirname, "..");
const cache = join(homedir(), ".claude/plugins/cache/crux/crux");

// CRUX_PLUGIN_ROOT first, else the newest installed plugin version.
function pluginRoot() {
  if (process.env.CRUX_PLUGIN_ROOT) return process.env.CRUX_PLUGIN_ROOT;
  if (!existsSync(cache)) return undefined;
  const versions = readdirSync(cache).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  const newest = versions.at(-1);
  return newest ? join(cache, newest) : undefined;
}

const plugin = pluginRoot();
const script = plugin && join(plugin, "scripts/derive-arch.py");
if (!script || !existsSync(script)) {
  console.error(
    `docs:arch needs the Crux plugin: set CRUX_PLUGIN_ROOT to its directory or install it under ${cache}.`,
  );
  process.exit(2);
}

// The flag defaults to on. A value in the environment wins, then one in the
// repository's .env (the whole file is read, but only this one variable is
// used and passed on), then "1". `.env.example` carries the default.
function overridesFlag() {
  if (process.env.CRUX_ARCH_ALLOW_OVERRIDES !== undefined)
    return process.env.CRUX_ARCH_ALLOW_OVERRIDES;
  const file = join(root, ".env");
  if (existsSync(file)) {
    const line = /^CRUX_ARCH_ALLOW_OVERRIDES=(.*)$/m.exec(
      readFileSync(file, "utf8"),
    );
    // A quoted value ("1") would otherwise reach Crux with its quotes and
    // silently disable the override.
    if (line?.[1] !== undefined)
      return line[1].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return "1";
}

// The scanners ignore .gitignore, so the generated OCR engine files would show
// as drift. Move them aside while the scanner runs; docs-arch-aside.mjs always
// puts them back (finally, SIGINT, SIGTERM, or a leftover from a killed run).
const ocr = join(root, "apps/web/public/ocr");
let child;
const status = await withAside(
  ocr,
  () =>
    new Promise((done) => {
      child = spawn(
        "uv",
        ["run", script, "--docs-dir", "bionic", ...process.argv.slice(2)],
        {
          cwd: root,
          stdio: "inherit",
          env: { ...process.env, CRUX_ARCH_ALLOW_OVERRIDES: overridesFlag() },
        },
      );
      child.on("error", (error) => {
        console.error(`docs:arch could not start uv: ${error.message}`);
        done(1);
      });
      child.on("close", (code) => done(code ?? 1));
    }),
  (signal) => child?.kill(signal),
);
process.exit(status);
