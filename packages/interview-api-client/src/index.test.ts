import { describe, expect, it, vi } from "vitest";

import { createInterviewApiClient, InterviewApiError } from "./index.js";

describe("createInterviewApiClient", () => {
  it("hides the API path, bearer token and tenant from callers", async () => {
    let capturedUrl = "";
    let capturedAuthorization = "";
    let capturedTenant = "";
    const client = createInterviewApiClient({
      baseUrl: "http://localhost:3000/",
      token: "secret",
      tenant: "local",
      fetch: async (input, init) => {
        capturedUrl = String(input);
        capturedAuthorization =
          new Headers(init?.headers).get("authorization") ?? "";
        capturedTenant =
          new Headers(init?.headers).get("x-omnitech-tenant") ?? "";
        return Response.json({ ok: true, aiConfigured: true });
      },
    });

    await client.health();

    expect(capturedUrl).toBe("http://localhost:3000/api/v1/health");
    expect(capturedAuthorization).toBe("Bearer secret");
    expect(capturedTenant).toBe("local");
  });

  it("maps every operation to the API contract", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    const client = createInterviewApiClient({
      baseUrl: "http://localhost:3000",
      fetch: fetchMock,
    });

    await client.route({ question: "Solve it", language: "auto" });
    await client.generate({ question: "Solve it", language: "php" });
    await client.listAnswers();
    await client.getAnswer("answer/id");
    await client.saveAnswer(answerInput);
    await client.run({ language: "php", code: "<?php", stdin: "" });
    await client.deleteAnswer("answer/id");

    expect(request(fetchMock, 1)).toMatchObject({
      url: "http://localhost:3000/api/v1/route",
      method: "POST",
      body: JSON.stringify({ question: "Solve it", language: "auto" }),
    });
    expect(request(fetchMock, 2).url).toBe(
      "http://localhost:3000/api/v1/generate",
    );
    expect(request(fetchMock, 3)).toMatchObject({
      url: "http://localhost:3000/api/v1/answers",
      method: undefined,
    });
    expect(request(fetchMock, 4).url).toBe(
      "http://localhost:3000/api/v1/answers/answer%2Fid",
    );
    expect(request(fetchMock, 5)).toMatchObject({
      url: "http://localhost:3000/api/v1/answers",
      body: JSON.stringify(answerInput),
    });
    expect(request(fetchMock, 6).url).toBe("http://localhost:3000/api/v1/run");
    expect(request(fetchMock, 7)).toMatchObject({
      url: "http://localhost:3000/api/v1/answers/answer%2Fid",
      method: "DELETE",
    });
  });

  it("lets per-request headers override client defaults", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, aiConfigured: true }),
    );
    const client = createInterviewApiClient({
      baseUrl: "http://localhost:3000",
      token: "secret",
      fetch: fetchMock,
    });

    await client.health();

    const headers = new Headers(request(fetchMock, 1).headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer secret");
  });

  it("surfaces structured API errors", async () => {
    const details = {
      error: { code: "invalid_request", message: "Question is required." },
    };
    const client = createInterviewApiClient({
      baseUrl: "http://localhost:3000",
      fetch: async () => Response.json(details, { status: 400 }),
    });

    const error = await client
      .route({ question: "", language: "auto" })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(InterviewApiError);
    expect(error).toMatchObject({
      name: "InterviewApiError",
      status: 400,
      message: "Question is required.",
      details,
    });
  });

  it("falls back to the HTTP status for an invalid error response", async () => {
    const client = createInterviewApiClient({
      baseUrl: "http://localhost:3000",
      fetch: async () => new Response("gateway offline", { status: 502 }),
    });

    await expect(client.health()).rejects.toMatchObject({
      status: 502,
      message: "API request failed with HTTP 502.",
    });
  });

  it("falls back when a structured error does not contain a message", async () => {
    const client = createInterviewApiClient({
      baseUrl: "http://localhost:3000",
      fetch: async () =>
        Response.json({ error: { code: "conflict" } }, { status: 409 }),
    });

    await expect(client.listAnswers()).rejects.toMatchObject({
      message: "API request failed with HTTP 409.",
    });
  });
});

const answerInput = {
  title: "Answer",
  language: "php" as const,
  answerMarkdown: "Explanation",
  code: "<?php",
  usageCode: "echo 'usage';",
  testCode: "",
  question: "Solve it",
  notes: "",
};

function request(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  const [input, init] = fetchMock.mock.calls[call - 1] as [
    RequestInfo | URL,
    RequestInit,
  ];
  return {
    url: String(input),
    method: init.method,
    body: init.body,
    headers: init.headers,
  };
}
