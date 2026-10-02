import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadLocalDefaultProfile } from "./local-default-profile.js";

it("loads the local default matrix without embedding private data in source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "briefing-default-"));
  try {
    expect(await loadLocalDefaultProfile({ directory })).toBeNull();
    await mkdir(join(directory, ".data"));
    const path = join(directory, ".data", "default-experience-matrix.json");
    const matrix = { candidate: { name: "Synthetic" }, roles: [] };
    await writeFile(path, JSON.stringify(matrix));
    expect(await loadLocalDefaultProfile({ directory })).toEqual({
      name: "My experience matrix",
      matrix,
    });
    await writeFile(path, "invalid json");
    await expect(loadLocalDefaultProfile({ directory })).rejects.toThrow();
    expect(
      await loadLocalDefaultProfile({ directory, production: true }),
    ).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
