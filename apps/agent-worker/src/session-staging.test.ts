// Staged-screenshot cleanup that needs no model and no runtime (ADR-0016):
// the startup sweep, the post-purge idle sweep that spares a running attempt,
// and dead processes' staging directories.
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sweepStagingBase } from "./session-agent-port";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "session-staging-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const leftover = async (directory: string) => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(join(directory, "attempt-x", "stage"), { recursive: true });
  await writeFile(join(directory, "attempt-x", "stage", "image-0.png"), "px");
};

describe("sweepStagingBase", () => {
  it("empties the base without any port or model", async () => {
    const base = join(root, "staging");
    await leftover(base);
    await sweepStagingBase(base);
    expect(await readdir(base)).toEqual([]);
  });

  it("creates a missing base private to the worker", async () => {
    const base = join(root, "fresh", "staging");
    await sweepStagingBase(base);
    expect(await readdir(base)).toEqual([]);
  });

  it("removes the default layout's directories of processes that no longer exist, never a live one's", async () => {
    // A pid that cannot belong to a running process, and this very process.
    const dead = join(root, "omnitech-session-agent-2147483000");
    const mine = join(root, `omnitech-session-agent-${process.pid}`);
    await leftover(dead);
    await leftover(mine);
    await sweepStagingBase(mine);
    expect(await readdir(root)).toEqual([
      `omnitech-session-agent-${process.pid}`,
    ]);
    expect(await readdir(mine)).toEqual([]);
  });

  it("leaves a custom base's siblings alone", async () => {
    const dead = join(root, "omnitech-session-agent-2147483000");
    await leftover(dead);
    await sweepStagingBase(join(root, "custom"));
    expect(await readdir(dead)).toEqual(["attempt-x"]);
  });
  it("refuses a base that is a planted link and leaves its target intact", async () => {
    const victim = join(root, "victim");
    await leftover(victim);
    const base = join(root, "omnitech-session-agent-planted");
    await symlink(victim, base);
    await expect(sweepStagingBase(base)).rejects.toThrow();
    expect(await readdir(victim)).toEqual(["attempt-x"]);
  });

  it("refuses a base other users could enter", async () => {
    const base = join(root, "open");
    await leftover(base);
    await chmod(base, 0o755);
    await expect(sweepStagingBase(base)).rejects.toThrow();
    expect(await readdir(base)).toEqual(["attempt-x"]);
  });

  it("does not follow a planted link named like a dead process's directory", async () => {
    const victim = join(root, "victim");
    await leftover(victim);
    await symlink(victim, join(root, "omnitech-session-agent-2147483000"));
    const mine = join(root, `omnitech-session-agent-${process.pid}`);
    await sweepStagingBase(mine);
    expect(await readdir(victim)).toEqual(["attempt-x"]);
  });

  it("skips ownership and mode bits where there is no uid, still refusing a link", async () => {
    const open = join(root, "open");
    await leftover(open);
    await chmod(open, 0o755);
    const getuid = process.getuid;
    const platform = process as { getuid?: (() => number) | undefined };
    platform.getuid = undefined;
    try {
      await sweepStagingBase(open);
      expect(await readdir(open)).toEqual([]);
      const link = join(root, "link");
      await symlink(open, link);
      await expect(sweepStagingBase(link)).rejects.toThrow();
    } finally {
      platform.getuid = getuid;
    }
  });
});
