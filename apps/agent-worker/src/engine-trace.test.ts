import { describe, expect, it } from "vitest";
import {
  ENGINE_CAPTURE_ENV,
  ENGINE_DATABASE_ENV,
  engineTrace,
} from "./engine-trace";

describe("where the worker's AI runs are kept", () => {
  it("keeps nothing and captures metadata when no database is named", async () => {
    const lines: string[] = [];
    const kept = engineTrace({}, (line) => lines.push(line));
    expect(kept.trace.capture).toBe("metadata");
    expect(typeof kept.trace.sink.write).toBe("function");
    await expect(kept.close()).resolves.toBeUndefined();
    // No store was opened, so nothing is said about one.
    expect(lines).toEqual([]);
  });

  it("captures content only for the exact value full", () => {
    expect(engineTrace({ [ENGINE_CAPTURE_ENV]: "full" }).trace.capture).toBe(
      "full",
    );
    for (const other of ["metadata", "FULL", "on", "", " full"])
      expect(engineTrace({ [ENGINE_CAPTURE_ENV]: other }).trace.capture).toBe(
        "metadata",
      );
  });

  it("closes with a database named, without one ever answering", async () => {
    // A closed local port: the connection is lazy and is never established.
    const kept = engineTrace({
      [ENGINE_DATABASE_ENV]: "postgres://nobody@127.0.0.1:1/absent",
    });
    expect(kept.trace.capture).toBe("metadata");
    await expect(kept.close()).resolves.toBeUndefined();
  });
});
