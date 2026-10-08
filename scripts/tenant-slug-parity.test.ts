import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { isTenantSlug } from "../apps/web/src/platform/native-handoff";

// The Mac companion validates the tenant slug before it builds an ingest URL;
// the web validates the same slug when it hands a session to the native app.
// Swift stays its own source; this test reads its pattern as text and checks
// both sides agree on a corpus, so one cannot drift from the other.
function repoRoot(from: string): string {
  let dir = from;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found");
    dir = parent;
  }
  return dir;
}

const SWIFT = join(
  repoRoot(process.cwd()),
  "apps/capture-companion/macos/Sources/CaptureCore/Endpoint.swift",
);

const CORPUS = [
  "acme",
  "a",
  "a-1",
  "0",
  "9lives",
  "Acme",
  "a.b",
  "a_b",
  "-acme",
  "acme-",
  "a/b",
  "",
  " acme",
  "acme ",
  "a".repeat(63),
  "a".repeat(64),
  "é",
];

describe("tenant slug parity with Endpoint.swift", () => {
  const source = readFileSync(SWIFT, "utf8");
  const match = /isValidSlug[\s\S]*?range\(of: "([^"]+)"/.exec(source);

  it("finds the Swift slug pattern", () => {
    expect(match?.[1]).toBeTruthy();
  });

  it("accepts and refuses the same slugs as the web", () => {
    const swift = new RegExp(match?.[1] ?? "(?!)");
    for (const slug of CORPUS)
      expect(swift.test(slug), JSON.stringify(slug)).toBe(isTenantSlug(slug));
  });
});
