import { describe, expect, it, vi } from "vitest";
import {
  startCodexAnswerSession,
  startCodexConceptSession,
} from "./terminal-client";

describe("startCodexConceptSession", () => {
  it("sends only the topic to the authenticated terminal boundary", async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        { name: "concept-abc", command: "/explain React effects" },
        { status: 201 },
      ),
    );

    await expect(
      startCodexConceptSession("React effects", {
        fetch,
        token: "secret",
        url: "http://terminal/concept-sessions",
      }),
    ).resolves.toEqual({
      name: "concept-abc",
      command: "/explain React effects",
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://terminal/concept-sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ topic: "React effects" }),
        headers: expect.objectContaining({
          authorization: "Bearer secret",
        }),
      }),
    );
  });

  it("surfaces terminal gateway errors", async () => {
    await expect(
      startCodexConceptSession("React", {
        fetch: async () =>
          Response.json({ error: "tmux is unavailable" }, { status: 503 }),
      }),
    ).rejects.toThrow("tmux is unavailable");
  });

  it("starts an answer session through the same terminal boundary", async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        { name: "answer-abc", command: "/answer Build a counter" },
        { status: 201 },
      ),
    );

    await expect(
      startCodexAnswerSession("Build a counter", { fetch }),
    ).resolves.toEqual({
      name: "answer-abc",
      command: "/answer Build a counter",
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/answer-sessions",
      expect.objectContaining({
        body: JSON.stringify({ question: "Build a counter" }),
      }),
    );
  });

  it("passes the current answer when refining", async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        { name: "answer-refine", command: "/answer refine Fix tests" },
        { status: 201 },
      ),
    );

    await startCodexAnswerSession("Build a counter", {
      fetch,
      refinement: "Fix tests",
      currentAnswer: { title: "Counter" },
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/answer-sessions",
      expect.objectContaining({
        body: JSON.stringify({
          question: "Build a counter",
          refinement: "Fix tests",
          currentAnswer: { title: "Counter" },
        }),
      }),
    );
  });
});
