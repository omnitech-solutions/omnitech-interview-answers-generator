import { chmodSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureNodePtySpawnHelperExecutable } from "./node-pty-helper.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createHelper(mode: number): { helper: string; packageRoot: string } {
  const packageRoot = join(
    tmpdir(),
    `node-pty-helper-${process.pid}-${temporaryDirectories.length}`,
  );
  const prebuild = join(packageRoot, "prebuilds", "darwin-arm64");
  const helper = join(prebuild, "spawn-helper");
  mkdirSync(prebuild, { recursive: true });
  writeFileSync(helper, "");
  chmodSync(helper, mode);
  temporaryDirectories.push(packageRoot);
  return { helper, packageRoot };
}

describe("ensureNodePtySpawnHelperExecutable", () => {
  it("restores execute permissions stripped during package installation", () => {
    const { helper, packageRoot } = createHelper(0o644);

    ensureNodePtySpawnHelperExecutable({
      platform: "darwin",
      arch: "arm64",
      packageRoot,
    });

    expect(statSync(helper).mode & 0o777).toBe(0o755);
  });

  it("preserves an executable helper's existing permissions", () => {
    const { helper, packageRoot } = createHelper(0o751);

    ensureNodePtySpawnHelperExecutable({
      platform: "darwin",
      arch: "arm64",
      packageRoot,
    });

    expect(statSync(helper).mode & 0o777).toBe(0o751);
  });

  it("does nothing on Windows", () => {
    expect(() =>
      ensureNodePtySpawnHelperExecutable({
        platform: "win32",
        arch: "x64",
        packageRoot: "/missing",
      }),
    ).not.toThrow();
  });
});
