import { describe, expect, it, vi } from "vitest";
import { startConceptSession } from "./concept-session.js";

describe("startConceptSession", () => {
  it("starts a detached Codex tmux session without shell interpolation", () => {
    const spawnSync = vi.fn(() => ({ status: 0, stderr: "" }));

    expect(
      startConceptSession(" React effects; echo unsafe ", {
        cwd: "/project",
        execArgv: [],
        sessionId: "abc",
        spawnSync: spawnSync as never,
      }),
    ).toEqual({
      name: "concept-abc",
      command: "/explain React effects; echo unsafe",
    });
    expect(spawnSync).toHaveBeenCalledWith(
      "tmux",
      [
        "new-session",
        "-d",
        "-s",
        "concept-abc",
        process.execPath,
        expect.stringMatching(/concept-runner\.ts$/),
        "React effects; echo unsafe",
      ],
      {
        cwd: "/project",
        encoding: "utf8",
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
  });

  it("rejects missing and oversized topics", () => {
    expect(() => startConceptSession(" ", { cwd: "/project" })).toThrow(
      "A concept topic is required.",
    );
    expect(() =>
      startConceptSession("x".repeat(4_001), { cwd: "/project" }),
    ).toThrow("at most 4000 characters");
  });

  it("reports tmux failures", () => {
    expect(() =>
      startConceptSession("React", {
        cwd: "/project",
        spawnSync: (() => ({
          status: 1,
          stderr: "duplicate session",
        })) as never,
      }),
    ).toThrow("duplicate session");
  });
});
