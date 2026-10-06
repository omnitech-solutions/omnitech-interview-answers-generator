import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asideName,
  restoreAside,
  withAside,
  // @ts-expect-error plain .mjs module without declarations
} from "./docs-arch-aside.mjs";

// The OCR engine directory is git-ignored but scanned by derive-arch, so
// docs:arch moves it aside. These tests pin that it is always put back.
let dir: string;
let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "docs-arch-aside-"));
  dir = join(work, "ocr");
  mkdirSync(dir);
  writeFileSync(join(dir, "worker.min.js"), "engine");
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

describe("withAside", () => {
  it("hides the directory during the task and restores it on success", async () => {
    const seen = await withAside(dir, async () => ({
      hidden: !existsSync(dir),
      aside: existsSync(asideName(dir)),
    }));
    expect(seen).toEqual({ hidden: true, aside: true });
    expect(readFileSync(join(dir, "worker.min.js"), "utf8")).toBe("engine");
    expect(existsSync(asideName(dir))).toBe(false);
  });

  it("restores the directory when the task throws, and rethrows", async () => {
    await expect(
      withAside(dir, async () => {
        throw new Error("scanner failed");
      }),
    ).rejects.toThrow("scanner failed");
    expect(readFileSync(join(dir, "worker.min.js"), "utf8")).toBe("engine");
    expect(existsSync(asideName(dir))).toBe(false);
  });

  it("runs the task when the directory does not exist", async () => {
    rmSync(dir, { recursive: true });
    await expect(withAside(dir, async () => 7)).resolves.toBe(7);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(asideName(dir))).toBe(false);
  });

  it("restores a leftover from a killed earlier run before starting", async () => {
    await withAside(dir, async () => {
      // Simulate a crash: leave the directory aside, as a SIGKILL would.
      expect(existsSync(asideName(dir))).toBe(true);
      throw new Error("stop");
    }).catch(() => undefined);
    // Put it aside by hand again, then start a fresh run.
    mkdirSync(asideName(dir));
    writeFileSync(join(asideName(dir), "left.txt"), "kept");
    rmSync(dir, { recursive: true });
    await withAside(dir, async () => {
      expect(existsSync(asideName(dir))).toBe(true);
    });
    expect(readFileSync(join(dir, "left.txt"), "utf8")).toBe("kept");
  });

  it("never overwrites a directory recreated while it was aside", async () => {
    await withAside(dir, async () => {
      mkdirSync(dir);
      writeFileSync(join(dir, "new.txt"), "new");
    });
    expect(readFileSync(join(dir, "new.txt"), "utf8")).toBe("new");
    expect(readFileSync(join(asideName(dir), "worker.min.js"), "utf8")).toBe(
      "engine",
    );
  });
});

describe("withAside signals", () => {
  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)(
    "restores the directory on %s and exits %i",
    async (signal, code) => {
      const module = fileURLToPath(
        new URL("./docs-arch-aside.mjs", import.meta.url),
      );
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { withAside } from ${JSON.stringify(module)};
         await withAside(${JSON.stringify(dir)}, () => {
           console.log("aside"); setInterval(() => {}, 1000);
           return new Promise(() => {});
         });`,
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      await new Promise<void>((ready) =>
        child.stdout.once("data", () => ready()),
      );
      expect(existsSync(dir)).toBe(false);
      const exited = new Promise<number | null>((done) =>
        child.on("close", (status) => done(status)),
      );
      child.kill(signal);
      expect(await exited).toBe(code);
      expect(readFileSync(join(dir, "worker.min.js"), "utf8")).toBe("engine");
      expect(existsSync(asideName(dir))).toBe(false);
    },
  );
});

describe("restoreAside", () => {
  it("is a no-op when nothing is aside", () => {
    restoreAside(dir);
    expect(existsSync(dir)).toBe(true);
  });
});
