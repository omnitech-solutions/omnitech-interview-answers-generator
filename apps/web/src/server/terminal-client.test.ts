import { describe, expect, it, vi } from "vitest";
import { startCodexConceptSession } from "./terminal-client";

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
});
