import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STUDIO_HOST_CAPABILITIES } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";

// The Mac shell advertises its capabilities as `HostCapability` in Swift; the
// page negotiates them against STUDIO_HOST_CAPABILITIES. Swift stays its own
// source of truth, read as text (like shared/shortcuts.test.ts), so a name added
// or renamed on one side only fails here instead of silently disabling a feature.
function repoRoot(from: string): string {
  let dir = from;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found");
    dir = parent;
  }
  return dir;
}

const HOST_BRIDGE_SWIFT = join(
  repoRoot(process.cwd()),
  "apps/studio-shell/Sources/StudioShellCore/HostBridge.swift",
);

// The raw value of each `case` in `enum HostCapability` (a bare case is named
// by its identifier).
function swiftCapabilities(): string[] {
  const source = readFileSync(HOST_BRIDGE_SWIFT, "utf8");
  const body = /enum HostCapability[^{]*\{([^}]*)\}/.exec(source)?.[1] ?? "";
  return [...body.matchAll(/^\s*case (\w+)(?: = "([^"]+)")?\s*$/gm)].map(
    ([, name = "", raw]) => raw ?? name,
  );
}

describe("host capability parity with HostBridge.swift", () => {
  it("reads the Swift enum", () => {
    // Guard against the parser silently matching nothing.
    expect(swiftCapabilities().length).toBeGreaterThanOrEqual(5);
  });

  it("the shell advertises exactly the capabilities the page negotiates", () => {
    expect([...swiftCapabilities()].sort()).toEqual(
      [...STUDIO_HOST_CAPABILITIES].sort(),
    );
  });
});
