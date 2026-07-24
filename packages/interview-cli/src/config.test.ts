import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const temporaryDirectories: string[] = [];

async function loadConfigModule() {
  const directory = await mkdtemp(join(tmpdir(), "interview-cli-"));
  temporaryDirectories.push(directory);
  vi.resetModules();
  vi.doMock("node:os", () => ({ homedir: () => directory }));
  return import("./config.js");
}

afterEach(async () => {
  vi.doUnmock("node:os");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CLI configuration", () => {
  it("returns an empty configuration when no file exists", async () => {
    const { readConfig } = await loadConfigModule();

    await expect(readConfig()).resolves.toEqual({});
  });

  it("writes private JSON and reads it back", async () => {
    const { configPath, readConfig, writeConfig } = await loadConfigModule();

    await writeConfig({ url: "http://localhost:3000", token: "secret" });

    await expect(readConfig()).resolves.toEqual({
      url: "http://localhost:3000",
      token: "secret",
    });
    expect(await readFile(configPath, "utf8")).toBe(
      '{\n  "url": "http://localhost:3000",\n  "token": "secret"\n}\n',
    );
  });

  it("surfaces malformed configuration instead of hiding it", async () => {
    const { configPath, readConfig } = await loadConfigModule();
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, "{broken");

    await expect(readConfig()).rejects.toBeInstanceOf(SyntaxError);
  });
});
