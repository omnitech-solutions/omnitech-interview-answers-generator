// The plan for a call over HTTP: the person's page writes it, the coach reads
// it. The store here is the real one over a temporary file, never the data
// directory.
import { rmSync } from "node:fs";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const held = vi.hoisted(() => ({ directory: "" }));

vi.mock("esbuild", () => ({ build: vi.fn() }));
vi.mock("./services", () => ({
  answerRepository: {},
  explanationRepository: {},
  codeRunner: {},
  generateInterviewAnswer: vi.fn(),
  generateExplanation: vi.fn(),
  libraryRepository: {},
  libraryService: {},
}));
vi.mock("./coach-plan", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const actual =
    await vi.importActual<typeof import("./coach-plan")>("./coach-plan");
  held.directory = mkdtempSync(join(tmpdir(), "coach-plan-api-"));
  return {
    ...actual,
    coachPlan: actual.createCoachPlan(join(held.directory, "coach-plan.md")),
  };
});

import { createApi } from "./api";

const URL = "http://localhost/api/v1/coach-plan";
let signedIn = true;
const app = () =>
  createApi({
    resolveScope: async () => null,
    verifySession: async () => signedIn,
  });
const read = () => app().request(URL);
const put = (body: unknown) =>
  app().request(URL, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const PLAN = "mode: system-design\nLand the ledger migration story.";

describe("the coach plan API", () => {
  const originalToken = process.env["INTERVIEW_API_TOKEN"];
  beforeEach(async () => {
    delete process.env["INTERVIEW_API_TOKEN"];
    await put({ text: "" });
  });
  afterEach(() => {
    if (originalToken === undefined) delete process.env["INTERVIEW_API_TOKEN"];
    else process.env["INTERVIEW_API_TOKEN"] = originalToken;
  });
  afterAll(() => rmSync(held.directory, { recursive: true, force: true }));

  it("answers an empty plan until one is written", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "" });
  });

  it("takes a plan with 200, answers it, and gives it back to the next reader", async () => {
    const written = await put({ text: PLAN });
    expect(written.status).toBe(200);
    expect(await written.json()).toEqual({ text: PLAN });
    expect(await (await read()).json()).toEqual({ text: PLAN });
  });

  it("replaces the plan held, and clears it with empty text", async () => {
    await put({ text: PLAN });
    await put({ text: "Ask about on-call." });
    expect(await (await read()).json()).toEqual({ text: "Ask about on-call." });
    expect((await put({ text: "" })).status).toBe(200);
    expect(await (await read()).json()).toEqual({ text: "" });
  });

  it("takes a plan of exactly a page", async () => {
    const page = "p".repeat(8_000);
    const written = await put({ text: page });
    expect(written.status).toBe(200);
    expect(await written.json()).toEqual({ text: page });
  });

  it.each([
    ["a plan over a page", { text: "p".repeat(8_001) }],
    ["a number", { text: 7 }],
    ["a list", { text: ["mode: coding"] }],
    ["null", { text: null }],
    ["no text at all", {}],
    ["a body that is not an object", "null"],
    ["text under another name", { plan: PLAN }],
  ])(
    "refuses %s with 400 invalid_coach_plan, and changes nothing",
    async (_name, body) => {
      await put({ text: PLAN });
      const refused = await put(body);
      expect(refused.status).toBe(400);
      const answer = (await refused.json()) as {
        error: { code: string; message: string; requestId: string };
      };
      expect(answer.error).toEqual({
        code: "invalid_coach_plan",
        message: "The plan is text of at most a page.",
        requestId: expect.any(String),
      });
      expect(await (await read()).json()).toEqual({ text: PLAN });
    },
  );

  it("refuses a body that is not JSON, and changes nothing", async () => {
    await put({ text: PLAN });
    const refused = await put("{not json");
    expect(refused.status).toBe(400);
    expect(await (await read()).json()).toEqual({ text: PLAN });
  });

  it("answers the fixed 401 to read or write when nobody is signed in and no token is configured, and changes nothing", async () => {
    await put({ text: PLAN });
    signedIn = false;
    try {
      for (const refused of [
        await read(),
        await put({ text: "Changed by nobody." }),
      ]) {
        expect(refused.status).toBe(401);
        expect(JSON.stringify(await refused.json())).not.toContain("ledger");
      }
    } finally {
      signedIn = true;
    }
    expect(await (await read()).json()).toEqual({ text: PLAN });
  });
});
