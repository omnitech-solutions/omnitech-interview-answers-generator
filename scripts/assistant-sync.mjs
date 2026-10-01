// Development only: copy a fresh omni-assistant build into the installed
// @omni-assistant/* packages, so edits to omni-assistant show up here without
// re-vendoring tarballs or touching package.json / pnpm-lock.yaml.
//
// The app still consumes the packages exactly as published (dist + migrations
// only); this just refreshes what pnpm installed from vendor/omni-assistant.
// Commit-time vendoring stays `pnpm pack` in omni-assistant -> vendor/.
//
//   node scripts/assistant-sync.mjs [--no-build]
//   OMNI_ASSISTANT_SRC=/path/to/omni-assistant overrides the default sibling checkout.
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
export const source = resolve(
  process.env.OMNI_ASSISTANT_SRC ?? resolve(root, "../omni-assistant"),
);
const packages = ["contracts", "providers", "server", "storage-postgres", "sdk", "react"];
const published = { "storage-postgres": ["dist", "migrations"] };

/** Installed copies of one package (pnpm adds a peer suffix for some). */
function installedCopies(name) {
  const store = resolve(root, "node_modules/.pnpm");
  return readdirSync(store)
    .filter((entry) => entry.startsWith(`@omni-assistant+${name}@file`))
    .map((entry) => resolve(store, entry, "node_modules/@omni-assistant", name));
}

/** @returns {Promise<string[]>} names of packages whose installed files changed */
export async function syncAssistant({ build = true } = {}) {
  if (!existsSync(resolve(source, "packages/server/package.json")))
    throw new Error(`omni-assistant checkout not found at ${source}`);
  if (build) await run("pnpm", ["run", "build"], { cwd: source, maxBuffer: 1 << 26 });
  const changed = [];
  for (const name of packages) {
    for (const destination of installedCopies(name)) {
      for (const part of published[name] ?? ["dist"]) {
        // rsync writes a new file and renames it, so the hard links pnpm's
        // content store shares with other projects are never modified in place.
        const { stdout } = await run("rsync", [
          "-a",
          // tsc rewrites unchanged files; compare content, not timestamps.
          "--checksum",
          "--delete",
          "--itemize-changes",
          `${resolve(source, "packages", name, part)}/`,
          `${resolve(destination, part)}/`,
        ]);
        const touched = stdout.split("\n").some((line) => /^(>f|\*deleting)/.test(line));
        if (touched && !changed.includes(name)) changed.push(name);
      }
    }
  }
  return changed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const changed = await syncAssistant({ build: !process.argv.includes("--no-build") });
  console.log(changed.length ? `synced: ${changed.join(", ")}` : "already up to date");
}
