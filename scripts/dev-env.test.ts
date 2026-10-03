import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadDevEnvironment } from "./dev-env.mjs";

const directory = mkdtempSync(join(tmpdir(), "omnitech-dev-env-"));
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it("loads root settings and lets app settings override them", () => {
  const rootFile = join(directory, ".env");
  const webFile = join(directory, "web.env.local");
  writeFileSync(rootFile, "MODEL=root\nROOT_ONLY=present\n");
  writeFileSync(webFile, "MODEL=web\n");
  expect(loadDevEnvironment({}, rootFile, webFile)).toEqual({
    MODEL: "web",
    ROOT_ONLY: "present",
  });
});

it("keeps exported variables and tolerates missing optional files", () => {
  const rootFile = join(directory, "missing-root");
  const webFile = join(directory, "missing-web");
  expect(loadDevEnvironment({ MODEL: "shell" }, rootFile, webFile)).toEqual({
    MODEL: "shell",
  });
});
