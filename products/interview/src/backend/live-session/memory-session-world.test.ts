// Pins the in-memory session world to the neutral core's own fence functions:
// the world a host's end-to-end suite runs on must decide eligibility, dedup
// and the holder's standing with the same code as the database path, never a
// reimplementation that could drift. No database.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as core from "./core/index.js";

const source = readFileSync(
  new URL("./memory-session-world.ts", import.meta.url),
  "utf8",
);

describe("memory session world", () => {
  it("imports its fence decisions from the core and defines none of its own", () => {
    const imported = /import \{([^}]*)\} from "\.\/core\/index\.js"/s.exec(
      source,
    )?.[1];
    const names = (imported ?? "").split(",").map((name) => name.trim());
    for (const fence of [
      "canPublish",
      "decideDispatch",
      "holderStanding",
      "revisionStanding",
    ]) {
      expect(names).toContain(fence);
      expect(typeof (core as Record<string, unknown>)[fence]).toBe("function");
      expect(source).not.toMatch(new RegExp(`(function|const) ${fence}\\b`));
    }
  });
});
