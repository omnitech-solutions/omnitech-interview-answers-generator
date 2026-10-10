// The behaviour flags over HTTP: the Settings pane and the agent worker read
// them, Settings changes them, and a flag the host set in the environment is
// reported as such and cannot be changed. The store here is the real one over
// a temporary file, never the data directory; its environment is the test's
// own, so the machine's variables decide nothing.
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

const held = vi.hoisted(() => ({
  directory: "",
  env: {} as Record<string, string | undefined>,
}));

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
vi.mock("./behaviour-flags", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const actual =
    await vi.importActual<typeof import("./behaviour-flags")>(
      "./behaviour-flags",
    );
  held.directory = mkdtempSync(join(tmpdir(), "behaviour-flags-api-"));
  return {
    ...actual,
    behaviourFlags: actual.createBehaviourFlagStore(
      join(held.directory, "behaviour-flags.json"),
      held.env,
    ),
  };
});

import { createApi } from "./api";

const URL = "http://localhost/api/v1/behaviour-flags";
const VOICE = "ACTIVE_SESSION_VOICE_ACTIVITY";
const COACH = "INTERVIEW_COACH";
const RETAIN = "INTERVIEW_COACH_RETAIN";
const GROUNDING = "INTERVIEW_COACH_GROUNDING";
const TOKEN = "behaviour-flags-test-token";

let signedIn = true;
const app = () =>
  createApi({
    resolveScope: async () => null,
    verifySession: async () => signedIn,
  });
const read = (headers: Record<string, string> = {}) =>
  app().request(URL, { headers });
const put = (body: unknown, headers: Record<string, string> = {}) =>
  app().request(URL, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
type Flag = {
  key: string;
  value: string;
  source: string;
  stored: string | null;
  default: string;
};
const flags = async (response: Response) =>
  ((await response.json()) as { flags: Flag[] }).flags;
const DEFAULTS: Flag[] = [
  { key: VOICE, value: "off", source: "default", stored: null, default: "off" },
  { key: COACH, value: "off", source: "default", stored: null, default: "off" },
  { key: RETAIN, value: "on", source: "default", stored: null, default: "on" },
  {
    key: GROUNDING,
    value: "on",
    source: "default",
    stored: null,
    default: "on",
  },
];

describe("the behaviour flags API", () => {
  const originalToken = process.env["INTERVIEW_API_TOKEN"];
  beforeEach(async () => {
    delete process.env["INTERVIEW_API_TOKEN"];
    for (const name of Object.keys(held.env)) delete held.env[name];
    // Back to every flag's default, stored as a setting.
    for (const flag of DEFAULTS)
      await put({ key: flag.key, value: flag.value });
  });
  afterEach(() => {
    if (originalToken === undefined) delete process.env["INTERVIEW_API_TOKEN"];
    else process.env["INTERVIEW_API_TOKEN"] = originalToken;
  });
  afterAll(() => rmSync(held.directory, { recursive: true, force: true }));

  it("answers every flag in the registry with its value, where it came from, what is stored and its default", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(await flags(response)).toEqual(
      DEFAULTS.map((flag) => ({
        ...flag,
        source: "setting",
        stored: flag.value,
      })),
    );
  });

  it("takes a change with 200, answers every flag, and gives it to the next reader", async () => {
    const written = await put({ key: VOICE, value: "on" });
    expect(written.status).toBe(200);
    const after = await flags(written);
    expect(after[0]).toEqual({
      key: VOICE,
      value: "on",
      source: "setting",
      stored: "on",
      default: "off",
    });
    expect(after).toHaveLength(4);
    expect(await flags(await read())).toEqual(after);
  });

  it("changes one flag and leaves the others as they were", async () => {
    await put({ key: COACH, value: "codex" });
    await put({ key: RETAIN, value: "off" });
    expect(
      (await flags(await read())).map((flag) => [flag.key, flag.value]),
    ).toEqual([
      [VOICE, "off"],
      [COACH, "codex"],
      [RETAIN, "off"],
      [GROUNDING, "on"],
    ]);
  });

  it.each([
    [
      "a flag that is not in the registry",
      { key: "LOG_CONTENT", value: "true" },
    ],
    [
      "a safety gate by its variable",
      { key: "ACTIVE_SESSION_RUNNER_DEVICE_LOCAL", value: "true" },
    ],
    ["a value the flag does not allow", { key: COACH, value: "gemini" }],
    ["a value in another case", { key: VOICE, value: "ON" }],
    ["a boolean", { key: VOICE, value: true }],
    ["no value", { key: VOICE }],
    ["an extra field", { key: VOICE, value: "on", source: "environment" }],
    ["a list of changes", [{ key: VOICE, value: "on" }]],
    ["a body that is not an object", "null"],
  ])(
    "refuses %s with 400 invalid_behaviour_flag, and changes nothing",
    async (_name, body) => {
      await put({ key: COACH, value: "claude" });
      const before = await flags(await read());
      const refused = await put(body);
      expect(refused.status).toBe(400);
      const answer = (await refused.json()) as {
        error: { code: string; message: string; requestId: string };
      };
      expect(answer.error).toEqual({
        code: "invalid_behaviour_flag",
        message: "The change names a flag and one of its values.",
        requestId: expect.any(String),
      });
      expect(await flags(await read())).toEqual(before);
    },
  );

  it("refuses a body that is not JSON, and changes nothing", async () => {
    await put({ key: VOICE, value: "on" });
    const refused = await put("{not json");
    expect(refused.status).toBe(400);
    expect((await flags(await read()))[0]?.value).toBe("on");
  });

  it("reports a flag the host set as the environment's, with what Settings holds beside it", async () => {
    await put({ key: VOICE, value: "on" });
    held.env[VOICE] = "off";
    held.env[COACH] = "codex";
    expect(await flags(await read())).toEqual([
      {
        key: VOICE,
        value: "off",
        source: "environment",
        stored: "on",
        default: "off",
      },
      {
        key: COACH,
        value: "codex",
        source: "environment",
        stored: "off",
        default: "off",
      },
      {
        key: RETAIN,
        value: "on",
        source: "setting",
        stored: "on",
        default: "on",
      },
      {
        key: GROUNDING,
        value: "on",
        source: "setting",
        stored: "on",
        default: "on",
      },
    ]);
  });

  it("refuses to change a flag the host set with 409 flag_set_by_environment, changes nothing, and still changes the others", async () => {
    held.env[VOICE] = "off";
    const refused = await put({ key: VOICE, value: "on" });
    expect(refused.status).toBe(409);
    expect(
      ((await refused.json()) as { error: { code: string; message: string } })
        .error,
    ).toMatchObject({
      code: "flag_set_by_environment",
      message: "This flag is set by the environment.",
    });
    expect((await flags(await read()))[0]).toMatchObject({
      value: "off",
      source: "environment",
      stored: "off",
    });
    expect((await put({ key: RETAIN, value: "off" })).status).toBe(200);
    // Once the host says nothing again, Settings decides.
    delete held.env[VOICE];
    expect((await put({ key: VOICE, value: "on" })).status).toBe(200);
    expect((await flags(await read()))[0]).toMatchObject({
      value: "on",
      source: "setting",
    });
  });

  it("reports the host's default for the coach while nothing else is said", async () => {
    held.env["INTERVIEW_COACH_DEFAULT"] = "claude";
    expect((await flags(await read()))[1]).toEqual({
      key: COACH,
      value: "off",
      source: "setting",
      stored: "off",
      default: "claude",
    });
  });

  it("answers the fixed 401 to read or write when nobody is signed in and no token is configured, and changes nothing", async () => {
    await put({ key: VOICE, value: "on" });
    signedIn = false;
    try {
      for (const refused of [
        await read(),
        await put({ key: VOICE, value: "off" }),
      ]) {
        expect(refused.status).toBe(401);
        const text = JSON.stringify(await refused.json());
        expect(text).toContain("unauthorized");
        expect(text).not.toContain(VOICE);
      }
    } finally {
      signedIn = true;
    }
    expect((await flags(await read()))[0]?.value).toBe("on");
  });

  it("lets the agent worker read and a script write with the API token alone, and refuses a wrong one", async () => {
    process.env["INTERVIEW_API_TOKEN"] = TOKEN;
    signedIn = false;
    try {
      const bearer = { authorization: `Bearer ${TOKEN}` };
      expect((await put({ key: COACH, value: "codex" }, bearer)).status).toBe(
        200,
      );
      const response = await read(bearer);
      expect(response.status).toBe(200);
      expect((await flags(response))[1]).toMatchObject({
        value: "codex",
        stored: "codex",
      });
      for (const refused of [
        await read({ authorization: "Bearer not-the-token" }),
        await put({ key: COACH, value: "off" }, { authorization: "Bearer x" }),
      ])
        expect(refused.status).toBe(401);
      expect((await flags(await read(bearer)))[1]?.value).toBe("codex");
    } finally {
      signedIn = true;
    }
  });

  it("refuses a signed-in browser that says the request is cross-site", async () => {
    const refused = await put(
      { key: VOICE, value: "on" },
      { "sec-fetch-site": "cross-site" },
    );
    expect(refused.status).toBe(401);
    expect((await flags(await read()))[0]?.value).toBe("off");
  });
});
