import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPlaygroundControlClient,
  parsePlaygroundPatch,
  PlaygroundControlError,
} from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parsePlaygroundPatch", () => {
  it("accepts a partial form update", () => {
    expect(
      parsePlaygroundPatch({
        question: "Build a counter.",
        language: "react",
        panel: "notes",
      }),
    ).toEqual({
      question: "Build a counter.",
      language: "react",
      panel: "notes",
    });
  });

  it("rejects unknown control names", () => {
    expect(() => parsePlaygroundPatch({ questions: "typo" })).toThrow(
      'Unknown Playground field "questions".',
    );
  });

  it("accepts a complete answer and preserves null as a reset", () => {
    const answer = {
      title: "Counter",
      language: "react" as const,
      answerMarkdown: "Use one state value.",
      code: "function App() {}",
      testCode: "test('counter', () => {})",
    };

    expect(parsePlaygroundPatch({ answer })).toEqual({ answer });
    expect(parsePlaygroundPatch({ answer: null })).toEqual({ answer: null });
  });

  it.each([
    [null, "Playground update must be a JSON object."],
    [[], "Playground update must be a JSON object."],
    [{ question: 42 }, 'Playground field "question" must be a string.'],
    [{ language: "python" }, 'Unsupported Playground language "python".'],
    [{ panel: "preview" }, 'Unsupported Playground panel "preview".'],
    [
      { answer: "nope" },
      'Playground field "answer" must be an object or null.',
    ],
    [
      {
        answer: {
          title: "Answer",
          language: "auto",
          answerMarkdown: "",
          code: "",
          testCode: "",
        },
      },
      'Playground answer language must be "php", "react", "typescript", or "ruby".',
    ],
    [
      {
        answer: {
          title: 123,
          language: "php",
          answerMarkdown: "",
          code: "",
          testCode: "",
        },
      },
      'Playground field "title" must be a string.',
    ],
  ])("rejects invalid input %#", (input, message) => {
    expect(() => parsePlaygroundPatch(input)).toThrow(message);
  });
});

describe("createPlaygroundControlClient", () => {
  it("sends a typed patch to the configured endpoint", async () => {
    const snapshot = {
      revision: 1,
      updatedAt: "2026-07-23T00:00:00.000Z",
      value: {
        question: "Build a counter.",
        language: "react" as const,
        answer: null,
        notes: "",
        panel: "notes" as const,
      },
    };
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify(snapshot), {
        headers: { "content-type": "application/json" },
      });
    });
    const client = createPlaygroundControlClient({
      baseUrl: "http://localhost:3000/",
      fetch: fetchMock,
      token: "secret",
    });

    await expect(client.set({ question: "Build a counter." })).resolves.toEqual(
      snapshot,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/playground-control",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ question: "Build a counter." }),
        headers: expect.objectContaining({
          authorization: "Bearer secret",
        }),
      }),
    );
  });

  it("gets and resets through a custom API path and headers", async () => {
    const snapshot = {
      revision: 2,
      updatedAt: "2026-07-23T00:00:00.000Z",
      value: {
        question: "",
        language: "auto" as const,
        answer: null,
        notes: "",
        panel: "notes" as const,
      },
    };
    const fetchMock = vi.fn(async () => Response.json(snapshot));
    const client = createPlaygroundControlClient({
      baseUrl: "http://localhost:3000",
      apiPath: "/control",
      fetch: fetchMock,
      headers: { "x-client": "test" },
    });

    await expect(client.get()).resolves.toEqual(snapshot);
    await expect(client.reset()).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/control",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "x-client": "test" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/control",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("surfaces the API error message and response details", async () => {
    const details = { error: { message: "Control is unavailable." } };
    const client = createPlaygroundControlClient({
      baseUrl: "http://localhost:3000",
      fetch: async () => Response.json(details, { status: 503 }),
    });

    const error = await client.get().catch((caught) => caught);

    expect(error).toBeInstanceOf(PlaygroundControlError);
    expect(error).toMatchObject({
      name: "PlaygroundControlError",
      status: 503,
      message: "Control is unavailable.",
      details,
    });
  });

  it("falls back to the HTTP status when an error is not JSON", async () => {
    const client = createPlaygroundControlClient({
      baseUrl: "http://localhost:3000",
      fetch: async () => new Response("offline", { status: 502 }),
    });

    await expect(client.reset()).rejects.toMatchObject({
      status: 502,
      message: "Playground control request failed with HTTP 502.",
    });
  });

  it("uses the platform fetch when no implementation is supplied", async () => {
    const snapshot = {
      revision: 0,
      updatedAt: "2026-07-23T00:00:00.000Z",
      value: {
        question: "",
        language: "auto" as const,
        answer: null,
        notes: "",
        panel: "notes" as const,
      },
    };
    const fetchMock = vi.fn(async () => Response.json(snapshot));
    vi.stubGlobal("fetch", fetchMock);

    const client = createPlaygroundControlClient({
      baseUrl: "http://localhost:3000",
    });

    await expect(client.get()).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to the status when a structured error omits its message", async () => {
    const client = createPlaygroundControlClient({
      baseUrl: "http://localhost:3000",
      fetch: async () => Response.json({ error: {} }, { status: 409 }),
    });

    await expect(client.get()).rejects.toMatchObject({
      message: "Playground control request failed with HTTP 409.",
    });
  });
});
