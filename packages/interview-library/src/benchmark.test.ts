import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const benchmarkDirectories = async () =>
  (await readdir(tmpdir())).filter((name) =>
    name.startsWith("library-benchmark-"),
  );

// `pnpm --filter @omnitech/interview-library benchmark` runs this module as a
// script: importing it runs the benchmark once and prints its report.
it("reports warm-search and restore timings for the deterministic corpus", async () => {
  const before = await benchmarkDirectories();
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

  await import("./benchmark.js");

  expect(log).toHaveBeenCalledTimes(1);
  const report = JSON.parse(String(log.mock.calls[0]?.[0]));
  expect(report).toEqual({
    fixture: { items: 1_000, sections: 10_000, matchedSections: 200 },
    warmSearchP95Ms: expect.any(Number),
    persistedRestoreMs: expect.any(Number),
    targets: { warmSearchP95Ms: 50, persistedRestoreMs: 250 },
  });
  // The persisted index lives in a temporary directory it removes.
  expect(await benchmarkDirectories()).toEqual(before);
}, 60_000);
