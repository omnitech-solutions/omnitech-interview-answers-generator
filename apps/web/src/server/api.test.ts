import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  createAiClientFromEnv: vi.fn(),
  deleteAnswer: vi.fn(),
  generateInterviewAnswer: vi.fn(),
  getAnswer: vi.fn(),
  listAnswers: vi.fn(),
  listAnswersPage: vi.fn(),
  runAllCode: vi.fn(),
  runCode: vi.fn(),
  checkSyntax: vi.fn(),
  saveAnswer: vi.fn(),
  generateExplanation: vi.fn(),
  listExplanations: vi.fn(),
  getExplanation: vi.fn(),
  saveExplanation: vi.fn(),
  deleteExplanation: vi.fn(),
}));

vi.mock("esbuild", () => ({ build: mocks.build }));
vi.mock("@omnitech/ai-sdk", () => ({
  createAiClientFromEnv: mocks.createAiClientFromEnv,
}));
vi.mock("./services", () => ({
  answerRepository: {
    delete: mocks.deleteAnswer,
    get: mocks.getAnswer,
    list: mocks.listAnswers,
    listPage: mocks.listAnswersPage,
    save: mocks.saveAnswer,
  },
  explanationRepository: {
    delete: mocks.deleteExplanation,
    get: mocks.getExplanation,
    list: mocks.listExplanations,
    save: mocks.saveExplanation,
  },
  codeRunner: {
    run: mocks.runCode,
    runAll: mocks.runAllCode,
    checkSyntax: mocks.checkSyntax,
  },
  generateInterviewAnswer: mocks.generateInterviewAnswer,
  generateExplanation: mocks.generateExplanation,
}));

import { createApi } from "./api";

const generatedAnswer = {
  title: "Readable Counter",
  language: "react" as const,
  answerMarkdown: "## Approach\n\nKeep state local.",
  code: "function App() { return <button>0</button>; }",
  usageCode: "render(<App />)",
  testCode: "render(<App />)",
};

const savedAnswer = {
  ...generatedAnswer,
  id: "123e4567-e89b-42d3-a456-426614174000",
  question: "Build a counter",
  notes: "Prefer a functional updater.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function jsonRequest(method: string, body?: unknown, headers?: HeadersInit) {
  return {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

async function responseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("web API", () => {
  const originalToken = process.env["INTERVIEW_API_TOKEN"];

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env["INTERVIEW_API_TOKEN"];
    mocks.listAnswers.mockResolvedValue([]);
    mocks.listExplanations.mockResolvedValue([]);
    mocks.listAnswersPage.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    mocks.createAiClientFromEnv.mockReturnValue({
      listProviders: () => [{ id: "fake", label: "Fake", model: "fake-1" }],
    });
    await createApi().request(
      "http://localhost/api/v1/playground-control",
      jsonRequest("DELETE"),
    );
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env["INTERVIEW_API_TOKEN"];
    } else {
      process.env["INTERVIEW_API_TOKEN"] = originalToken;
    }
  });

  it("routes a valid question and rejects an invalid routing request", async () => {
    const app = createApi();
    const routed = await app.request(
      "http://localhost/api/v1/route",
      jsonRequest("POST", {
        question: "Build an accessible React counter",
        language: "auto",
      }),
    );
    const invalid = await app.request(
      "http://localhost/api/v1/route",
      jsonRequest("POST", { question: "   ", language: "auto" }),
    );

    expect(routed.status).toBe(200);
    expect(await responseJson(routed)).toMatchObject({ language: "react" });
    expect(invalid.status).toBe(400);
    expect(await responseJson(invalid)).toMatchObject({
      error: {
        code: "invalid_request",
        message: "The routing request is invalid.",
      },
    });
  });

  it("exposes deterministic fake model and completion endpoints", async () => {
    const app = createApi();
    const models = await app.request("http://localhost/api/fake/v1/models");
    const completion = await app.request(
      "http://localhost/api/fake/v1/chat/completions",
      jsonRequest("POST", {
        model: "fake-interview-model",
        messages: [{ content: "Target language: PHP" }],
      }),
    );
    const fallback = await app.request(
      "http://localhost/api/fake/v1/chat/completions",
      jsonRequest("POST", { messages: [{ content: null }] }),
    );

    expect(await models.json()).toMatchObject({
      object: "list",
      data: [{ id: "fake-interview-model" }],
    });
    const completionBody = await responseJson(completion);
    const choices = completionBody["choices"] as Array<{
      message: { content: string };
    }>;
    expect(JSON.parse(choices[0]!.message.content)).toMatchObject({
      title: "Fake PHP Answer",
      language: "php",
    });
    expect(await fallback.json()).toMatchObject({
      model: "fake-interview-model",
    });
    const explanation = await app.request(
      "http://localhost/api/fake/v1/chat/completions",
      jsonRequest("POST", {
        messages: [{ content: "Concept to explain: React hooks" }],
      }),
    );
    const explanationBody = await responseJson(explanation);
    const explanationChoices = explanationBody["choices"] as Array<{
      message: { content: string };
    }>;
    expect(JSON.parse(explanationChoices[0]!.message.content)).toMatchObject({
      title: "Interview-ready concept",
    });
  });

  it("reports configured providers and tolerates missing AI configuration", async () => {
    const app = createApi();
    const configured = await app.request("http://localhost/api/v1/health");
    mocks.createAiClientFromEnv.mockImplementationOnce(() => {
      throw new Error("not configured");
    });
    const unconfigured = await app.request("http://localhost/api/v1/health");

    expect(await configured.json()).toEqual({
      ok: true,
      providers: [{ id: "fake", label: "Fake", model: "fake-1" }],
    });
    expect(await unconfigured.json()).toEqual({ ok: true, providers: [] });
  });

  it("generates an answer and maps provider failures to a stable error", async () => {
    const app = createApi();
    mocks.generateInterviewAnswer.mockResolvedValueOnce(generatedAnswer);

    const success = await app.request(
      "http://localhost/api/v1/generate",
      jsonRequest("POST", {
        question: "Build a counter",
        language: "react",
        providerId: "test-provider",
      }),
    );

    expect(success.status).toBe(200);
    expect(await success.json()).toEqual(generatedAnswer);
    expect(mocks.generateInterviewAnswer).toHaveBeenCalledWith({
      question: "Build a counter",
      language: "react",
      providerId: "test-provider",
    });

    mocks.generateInterviewAnswer.mockRejectedValueOnce(
      new Error("provider secret must not leak"),
    );
    const failure = await app.request(
      "http://localhost/api/v1/generate",
      jsonRequest("POST", {
        question: "Build a counter",
        language: "react",
      }),
    );

    expect(failure.status).toBe(503);
    expect(await responseJson(failure)).toMatchObject({
      error: {
        code: "generation_failed",
        message: "The configured AI provider could not generate an answer.",
      },
    });
  });

  it("rejects an invalid generation request before calling AI", async () => {
    const response = await createApi().request(
      "http://localhost/api/v1/generate",
      jsonRequest("POST", { question: "", language: "react" }),
    );

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      error: {
        code: "invalid_request",
        message: "The generation request is invalid.",
      },
    });
    expect(mocks.generateInterviewAnswer).not.toHaveBeenCalled();
  });

  it("generates and persists Concept Lab explanations", async () => {
    const app = createApi();
    const generated = { title: "React hooks", markdown: "## Talking points" };
    const saved = {
      ...generated,
      id: "123e4567-e89b-42d3-a456-426614174000",
      topic: "React hooks",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };
    mocks.generateExplanation.mockResolvedValue(generated);
    mocks.listExplanations.mockResolvedValue([saved]);
    mocks.getExplanation.mockResolvedValue(saved);
    mocks.saveExplanation.mockResolvedValue(saved);
    mocks.deleteExplanation.mockResolvedValue(true);

    expect(
      (
        await app.request(
          "http://localhost/api/v1/explain",
          jsonRequest("POST", { topic: "React hooks" }),
        )
      ).status,
    ).toBe(200);
    expect(
      await (await app.request("http://localhost/api/v1/explanations")).json(),
    ).toEqual([saved]);
    expect(
      (await app.request(`http://localhost/api/v1/explanations/${saved.id}`))
        .status,
    ).toBe(200);
    expect(
      (
        await app.request(
          "http://localhost/api/v1/explanations",
          jsonRequest("POST", {
            topic: saved.topic,
            title: saved.title,
            markdown: saved.markdown,
          }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await app.request(`http://localhost/api/v1/explanations/${saved.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
  });

  it("validates explanation requests and maps provider failures", async () => {
    const app = createApi();
    const invalid = await app.request(
      "http://localhost/api/v1/explain",
      jsonRequest("POST", { topic: "" }),
    );
    mocks.generateExplanation.mockRejectedValueOnce(new Error("secret"));
    const failed = await app.request(
      "http://localhost/api/v1/explain",
      jsonRequest("POST", { topic: "React" }),
    );
    expect(invalid.status).toBe(400);
    expect(failed.status).toBe(503);

    mocks.getExplanation.mockResolvedValue(undefined);
    mocks.deleteExplanation.mockResolvedValue(false);
    expect(
      (await app.request("http://localhost/api/v1/explanations/missing"))
        .status,
    ).toBe(404);
    expect(
      (
        await app.request("http://localhost/api/v1/explanations/missing", {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          "http://localhost/api/v1/explanations",
          jsonRequest("POST", { title: "" }),
        )
      ).status,
    ).toBe(400);
  });

  it("lists, reads, saves, and deletes answers through the repository", async () => {
    const app = createApi();
    mocks.listAnswers.mockResolvedValue([savedAnswer]);
    mocks.listAnswersPage.mockResolvedValue({
      items: [savedAnswer],
      total: 1,
      page: 1,
      pageSize: 10,
    });
    mocks.getAnswer.mockResolvedValue(savedAnswer);
    mocks.saveAnswer.mockResolvedValue(savedAnswer);
    mocks.deleteAnswer.mockResolvedValue(true);

    const list = await app.request("http://localhost/api/v1/answers");
    const get = await app.request(
      `http://localhost/api/v1/answers/${savedAnswer.id}`,
    );
    const save = await app.request(
      "http://localhost/api/v1/answers",
      jsonRequest("POST", {
        ...generatedAnswer,
        question: savedAnswer.question,
        notes: savedAnswer.notes,
      }),
    );
    const remove = await app.request(
      `http://localhost/api/v1/answers/${savedAnswer.id}`,
      { method: "DELETE" },
    );

    expect(await list.json()).toEqual([savedAnswer]);
    expect(await get.json()).toEqual(savedAnswer);
    expect(save.status).toBe(201);
    expect(await save.json()).toEqual(savedAnswer);
    expect(mocks.saveAnswer).toHaveBeenCalledWith({
      ...generatedAnswer,
      question: savedAnswer.question,
      notes: savedAnswer.notes,
    });
    expect(await remove.json()).toEqual({ deleted: true });
  });

  it("supports paginated answer listing and validates pagination", async () => {
    const app = createApi();
    const page = { items: [savedAnswer], total: 4, page: 2, pageSize: 1 };
    mocks.listAnswersPage.mockResolvedValue(page);

    const response = await app.request(
      "http://localhost/api/v1/answers?page=2&pageSize=1",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
    expect(mocks.listAnswersPage).toHaveBeenCalledWith(2, 1);

    const invalid = await app.request(
      "http://localhost/api/v1/answers?page=0&pageSize=1",
    );
    expect(invalid.status).toBe(400);
    expect(mocks.listAnswersPage).toHaveBeenCalledTimes(1);
  });

  it("returns not-found and validation errors for answer operations", async () => {
    const app = createApi();
    mocks.getAnswer.mockResolvedValue(undefined);
    mocks.deleteAnswer.mockResolvedValue(false);

    const missing = await app.request(
      "http://localhost/api/v1/answers/missing",
    );
    const removeMissing = await app.request(
      "http://localhost/api/v1/answers/missing",
      { method: "DELETE" },
    );
    const invalid = await app.request(
      "http://localhost/api/v1/answers",
      jsonRequest("POST", { title: "" }),
    );

    expect(missing.status).toBe(404);
    expect(removeMissing.status).toBe(404);
    expect(invalid.status).toBe(400);
    expect(await responseJson(invalid)).toMatchObject({
      error: { code: "invalid_request", message: "The answer is invalid." },
    });
  });

  it("updates, reads, validates, and resets playground control state", async () => {
    const app = createApi();
    const initialResponse = await app.request(
      "http://localhost/api/v1/playground-control",
    );
    const initial = await responseJson(initialResponse);
    const updatedResponse = await app.request(
      "http://localhost/api/v1/playground-control",
      jsonRequest("PATCH", {
        question: "Build a counter",
        language: "react",
        notes: "Keep it simple.",
        panel: "terminal",
        answer: generatedAnswer,
      }),
    );
    const updated = await responseJson(updatedResponse);

    expect(updated).toMatchObject({
      revision: Number(initial["revision"]) + 1,
      value: {
        question: "Build a counter",
        language: "react",
        answer: generatedAnswer,
      },
    });

    await app.request(
      "http://localhost/api/v1/playground-control",
      jsonRequest("PATCH", {
        view: "concept-lab",
        explanation: {
          topic: "Root",
          title: "Root briefing",
          markdown: "Root answer.",
        },
      }),
    );
    const appended = await app.request(
      "http://localhost/api/v1/playground-control/explanations",
      jsonRequest("POST", {
        topic: "Follow-up",
        title: "Cache expiry",
        markdown: "Expire after 60 seconds.",
      }),
    );
    expect(await responseJson(appended)).toMatchObject({
      value: {
        view: "concept-lab",
        explanation: { title: "Cache expiry" },
        explanations: [{ title: "Root briefing" }, { title: "Cache expiry" }],
      },
    });

    const invalidAppend = await app.request(
      "http://localhost/api/v1/playground-control/explanations",
      jsonRequest("POST", { title: "Missing fields" }),
    );
    expect(invalidAppend.status).toBe(400);

    const clearedSession = await app.request(
      "http://localhost/api/v1/playground-control",
      jsonRequest("PATCH", { explanation: null }),
    );
    expect(await responseJson(clearedSession)).toMatchObject({
      value: { explanation: null, explanations: [] },
    });

    const invalid = await app.request(
      "http://localhost/api/v1/playground-control",
      jsonRequest("PATCH", { pannel: "output" }),
    );
    expect(invalid.status).toBe(400);
    expect(await responseJson(invalid)).toMatchObject({
      error: {
        code: "invalid_playground_update",
        message: 'Unknown Playground field "pannel".',
      },
    });

    const reset = await app.request(
      "http://localhost/api/v1/playground-control",
      { method: "DELETE" },
    );
    expect(await responseJson(reset)).toMatchObject({
      value: {
        question: "",
        language: "auto",
        answer: null,
        notes: "",
        panel: "terminal",
        explanations: [],
      },
    });
  });

  it("runs supported code and reports validation and runner failures", async () => {
    const app = createApi();
    const runResult = {
      stdout: "3\n",
      stderr: "",
      exitCode: 0,
      durationMs: 12,
      timedOut: false,
    };
    mocks.runCode.mockResolvedValueOnce(runResult);

    const success = await app.request(
      "http://localhost/api/v1/run",
      jsonRequest("POST", {
        language: "php",
        code: "<?php echo 1 + 2;",
        stdin: "",
      }),
    );
    expect(await success.json()).toEqual(runResult);

    const invalid = await app.request(
      "http://localhost/api/v1/run",
      jsonRequest("POST", {
        language: "react",
        code: "function App() {}",
      }),
    );
    expect(invalid.status).toBe(400);

    mocks.runCode.mockRejectedValueOnce(new Error("Docker unavailable"));
    const unavailable = await app.request(
      "http://localhost/api/v1/run",
      jsonRequest("POST", {
        language: "typescript",
        code: "console.log('hello')",
      }),
    );
    expect(unavailable.status).toBe(503);
    expect(await responseJson(unavailable)).toMatchObject({
      error: { code: "runner_unavailable" },
    });
  });

  it("checks syntax without executing the answer", async () => {
    const app = createApi();
    const syntaxResult = {
      stdout: "No syntax errors detected",
      stderr: "",
      exitCode: 0,
      durationMs: 4,
      timedOut: false,
    };
    mocks.checkSyntax.mockResolvedValueOnce(syntaxResult);

    const response = await app.request(
      "http://localhost/api/v1/syntax-check",
      jsonRequest("POST", { language: "php", code: "<?php echo 'ok';" }),
    );

    expect(await response.json()).toEqual(syntaxResult);
    expect(mocks.checkSyntax).toHaveBeenCalledWith({
      language: "php",
      code: "<?php echo 'ok';",
    });
    expect(mocks.runCode).not.toHaveBeenCalled();
    expect(mocks.runAllCode).not.toHaveBeenCalled();

    const invalid = await app.request(
      "http://localhost/api/v1/syntax-check",
      jsonRequest("POST", { language: "php", code: "" }),
    );
    expect(invalid.status).toBe(400);

    mocks.checkSyntax.mockRejectedValueOnce(new Error("Docker unavailable"));
    const unavailable = await app.request(
      "http://localhost/api/v1/syntax-check",
      jsonRequest("POST", { language: "ruby", code: "puts 'ok'" }),
    );
    expect(unavailable.status).toBe(503);
  });

  it("runs the complete answer with its language-specific test framework", async () => {
    const app = createApi();
    const invalid = await app.request(
      "http://localhost/api/v1/run-all",
      jsonRequest("POST", { language: "typescript" }),
    );
    expect(invalid.status).toBe(400);

    const runResult = {
      stdout:
        "✓ solution.test.ts > handles an empty input\n\nTest Files  1 passed\nTests  1 passed\n",
      stderr: "",
      exitCode: 0,
      durationMs: 281,
      timedOut: false,
    };
    mocks.runAllCode.mockResolvedValueOnce(runResult);

    const request = {
      language: "typescript",
      code: "function solve(values: number[]) { return values.length; }",
      usageCode: "console.log(solve([1, 2]));",
      testCode:
        'import { expect, it } from "vitest"; it("handles an empty input", () => expect(solve([])).toBe(0));',
      stdin: "",
    };
    const success = await app.request(
      "http://localhost/api/v1/run-all",
      jsonRequest("POST", request),
    );

    expect(await success.json()).toEqual(runResult);
    expect(mocks.runAllCode).toHaveBeenCalledWith(request);

    const withoutTests = await app.request(
      "http://localhost/api/v1/run-all",
      jsonRequest("POST", { ...request, testCode: "" }),
    );
    expect(withoutTests.status).toBe(200);
    expect(mocks.runAllCode).toHaveBeenLastCalledWith({
      ...request,
      testCode: "",
    });

    mocks.runAllCode.mockRejectedValueOnce(new Error("runner image missing"));
    const unavailable = await app.request(
      "http://localhost/api/v1/run-all",
      jsonRequest("POST", request),
    );
    expect(unavailable.status).toBe(503);
    expect(await responseJson(unavailable)).toMatchObject({
      error: {
        code: "runner_unavailable",
        message: expect.stringContaining("pnpm runner:build"),
      },
    });
  });

  it("compiles valid React previews and reports invalid or failed compilation", async () => {
    const app = createApi();
    mocks.build.mockResolvedValueOnce({
      outputFiles: [{ text: "compiled preview" }],
    });

    const success = await app.request(
      "http://localhost/api/v1/react-preview",
      jsonRequest("POST", { code: "function App() { return <main />; }" }),
    );
    expect(await success.json()).toEqual({ javascript: "compiled preview" });
    expect(mocks.build).toHaveBeenCalledWith(
      expect.objectContaining({
        bundle: true,
        format: "iife",
        stdin: expect.objectContaining({ loader: "tsx" }),
      }),
    );

    const empty = await app.request(
      "http://localhost/api/v1/react-preview",
      jsonRequest("POST", { code: " " }),
    );
    expect(empty.status).toBe(400);

    mocks.build.mockRejectedValueOnce(new Error("Unexpected token"));
    const failed = await app.request(
      "http://localhost/api/v1/react-preview",
      jsonRequest("POST", { code: "function App( {" }),
    );
    expect(failed.status).toBe(400);
    expect(await responseJson(failed)).toMatchObject({
      error: { code: "compile_failed", message: "Unexpected token" },
    });
  });

  it("requires a bearer token for cross-origin requests but permits same-origin requests", async () => {
    process.env["INTERVIEW_API_TOKEN"] = "secret-token";
    const app = createApi();

    const unauthorized = await app.request("http://localhost/api/v1/answers", {
      headers: { origin: "https://example.com" },
    });
    const authorized = await app.request("http://localhost/api/v1/answers", {
      headers: { authorization: "Bearer secret-token" },
    });
    const sameOrigin = await app.request("http://localhost/api/v1/answers", {
      headers: { origin: "http://localhost" },
    });

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(sameOrigin.status).toBe(200);
  });

  it("adds request IDs to responses and returns a structured unknown-route error", async () => {
    const response = await createApi().request(
      "http://localhost/api/v1/does-not-exist",
      { headers: { "x-request-id": "request-from-test" } },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe("request-from-test");
    expect(await responseJson(response)).toMatchObject({
      error: {
        code: "not_found",
        requestId: "request-from-test",
        message: "The API route was not found.",
      },
    });
  });
});
