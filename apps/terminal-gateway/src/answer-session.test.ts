import { describe, expect, it, vi } from "vitest";
import { startAnswerSession } from "./answer-session.js";

describe("startAnswerSession", () => {
  it("starts the focused answer runner in a detached session", () => {
    const spawnSync = vi.fn(() => ({ status: 0, stderr: "" }));

    expect(
      startAnswerSession(" Build a counter; echo unsafe ", {
        cwd: "/project",
        execArgv: [],
        sessionId: "abc",
        spawnSync: spawnSync as never,
      }),
    ).toEqual({
      name: "answer-abc",
      command: "/answer Build a counter; echo unsafe",
    });
    expect(spawnSync).toHaveBeenCalledWith(
      "tmux",
      [
        "new-session",
        "-d",
        "-s",
        "answer-abc",
        process.execPath,
        expect.stringMatching(/answer-runner\.ts$/),
        "Build a counter; echo unsafe",
        "",
        "",
      ],
      {
        cwd: "/project",
        encoding: "utf8",
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
  });

  it("rejects missing and oversized questions", () => {
    expect(() => startAnswerSession(" ", { cwd: "/project" })).toThrow(
      "An interview question is required.",
    );
    expect(() =>
      startAnswerSession("x".repeat(8_001), { cwd: "/project" }),
    ).toThrow("at most 8000 characters");
  });

  it("passes a refinement and current answer without shell interpolation", () => {
    const spawnSync = vi.fn(() => ({ status: 0, stderr: "" }));
    const currentAnswer = {
      title: "Counter",
      language: "typescript",
      answerMarkdown: "## Question",
      code: "// PROBLEM:\n// STRATEGY:\n// COMPLEXITY:\nfunction count() {}",
      usageCode: "count();",
      testCode: "test();",
      notes: "",
    };

    expect(
      startAnswerSession("Build a counter", {
        cwd: "/project",
        currentAnswer,
        execArgv: [],
        refinement: "Fix tests; echo unsafe",
        sessionId: "refine",
        spawnSync: spawnSync as never,
      }),
    ).toEqual({
      name: "answer-refine",
      command: "/answer refine Fix tests; echo unsafe",
    });
    expect((spawnSync.mock.calls as unknown[][])[0]?.[1]).toEqual(
      expect.arrayContaining([
        "Build a counter",
        "Fix tests; echo unsafe",
        JSON.stringify(currentAnswer),
      ]),
    );
  });

  it("validates refinements before starting tmux", () => {
    expect(() =>
      startAnswerSession("Build a counter", {
        cwd: "/project",
        refinement: "x".repeat(4_001),
      }),
    ).toThrow("at most 4000 characters");
    expect(() =>
      startAnswerSession("Build a counter", {
        cwd: "/project",
        refinement: "Fix the tests",
      }),
    ).toThrow("current answer is required");
  });

  it("surfaces tmux startup errors", () => {
    expect(() =>
      startAnswerSession("Build a counter", {
        cwd: "/project",
        spawnSync: (() => ({
          error: new Error("tmux unavailable"),
          status: null,
        })) as never,
      }),
    ).toThrow("tmux unavailable");
    expect(() =>
      startAnswerSession("Build a counter", {
        cwd: "/project",
        spawnSync: (() => ({ status: 1, stderr: "session failed" })) as never,
      }),
    ).toThrow("session failed");
    expect(() =>
      startAnswerSession("Build a counter", {
        cwd: "/project",
        spawnSync: (() => ({ status: 2, stderr: "" })) as never,
      }),
    ).toThrow("tmux exited with status 2");
  });
});
