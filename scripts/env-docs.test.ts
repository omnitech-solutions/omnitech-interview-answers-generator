// Every environment variable the code reads is documented (L6-15), and every
// variable .env.example documents is still read. Reads are found with the
// TypeScript compiler API in scripts/env-reads.ts, including reads through
// helpers such as whole(env, "AGENT_WORKER_POLL_MS", ...). A name is
// documented when it appears in .env.example, README.md or USER_GUIDE.md.
// The lists below are configuration with reasons, not suppressions: an entry
// that no longer applies fails the test.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { productionEnvReads } from "./env-reads.js";
import { repoRoot } from "./guard-support.js";

// Variables the operating system, Node or Next set; nobody configures them
// through .env, so they are read but not documented.
const providedByTheEnvironment: Readonly<Record<string, string>> = {
  PATH: "the shell's executable search path, read to find the codex binary",
  HOME: "the user's home directory, read to find the lms binary",
  NODE_ENV:
    "set by Node tooling and Next; production switches dev conveniences off",
  NEXT_RUNTIME:
    "set by Next per runtime; instrumentation reads it to pick the node runtime",
};

// Documented variables that are read through a computed key, which the scan
// cannot see, with where the key is built.
const readThroughComputedKeys: Readonly<Record<string, string>> = {
  INTEGRATION_GOOGLE_ID:
    "packages/platform-integrations/src/oauth.ts builds INTEGRATION_<PROVIDER>_ID",
  INTEGRATION_GOOGLE_SECRET:
    "packages/platform-integrations/src/oauth.ts builds INTEGRATION_<PROVIDER>_SECRET",
  INTEGRATION_LINKEDIN_ID:
    "packages/platform-integrations/src/oauth.ts builds INTEGRATION_<PROVIDER>_ID",
  INTEGRATION_LINKEDIN_SECRET:
    "packages/platform-integrations/src/oauth.ts builds INTEGRATION_<PROVIDER>_SECRET",
};

const read = (file: string) => readFileSync(join(repoRoot, file), "utf8");
const envExample = read(".env.example");
const prose = [envExample, read("README.md"), read("USER_GUIDE.md")].join("\n");
const mentions = (name: string) =>
  new RegExp(`(^|[^A-Z0-9_])${name}([^A-Z0-9_]|$)`).test(prose);

const reads = productionEnvReads();
const names = new Set(reads.map((entry) => entry.name));
const documented = [...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map(
  (match) => match[1] as string,
);

it("finds the variables the code reads", () => {
  for (const name of [
    "DATABASE_URL",
    "AGENT_WORKER_POLL_MS",
    "ACTIVE_SESSION_AGENT_INTEGRATION",
    "NEXT_DIST_DIR",
  ])
    expect(names, name).toContain(name);
  expect(names.size).toBeGreaterThan(80);
  expect(documented.length).toBeGreaterThan(60);
});

it("documents every variable the code reads", () => {
  const missing = [...names]
    .filter((name) => !(name in providedByTheEnvironment) && !mentions(name))
    .sort()
    .map((name) => {
      const where = reads.find((entry) => entry.name === name)?.file;
      return `${name} (read in ${where})`;
    });
  expect(
    missing,
    "Add each to .env.example with its purpose and default (or to the README configuration tables)",
  ).toEqual([]);
});

it("documents no variable that nothing reads", () => {
  const stale = documented.filter(
    (name) => !names.has(name) && !(name in readThroughComputedKeys),
  );
  expect(
    stale,
    "Remove the entry from .env.example, or the code that read it was removed",
  ).toEqual([]);
});

it("keeps the exception lists real and reasoned", () => {
  for (const [name, reason] of Object.entries(providedByTheEnvironment)) {
    expect(reason.length, name).toBeGreaterThan(20);
    expect(names, `${name} is no longer read: delete the entry`).toContain(
      name,
    );
  }
  for (const [name, reason] of Object.entries(readThroughComputedKeys)) {
    expect(reason.length, name).toBeGreaterThan(20);
    expect(documented, `${name} is no longer in .env.example`).toContain(name);
    expect(
      names,
      `${name} is now read by name: delete the entry`,
    ).not.toContain(name);
  }
});
