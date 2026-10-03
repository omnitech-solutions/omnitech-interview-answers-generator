import { beforeEach, describe, expect, it, vi } from "vitest";

const guide = {
  version: 1 as const,
  understand: {
    prompt: "Solve it",
    examples: [],
    constraints: [],
    clarify: [],
  },
  plan: { steps: ["Solve it."], complexity: { time: "O(1)", space: "O(1)" } },
  edgeCases: [],
  explain: [{ heading: "Approach", body: "Solve it." }],
  talkingPoints: ["One.", "Two.", "Three."],
};

const apiClient = {
  deleteAnswer: vi.fn(),
  generate: vi.fn(),
  getAnswer: vi.fn(),
  health: vi.fn(),
  listAnswers: vi.fn(),
  route: vi.fn(),
  run: vi.fn(),
  saveAnswer: vi.fn(),
};
const playgroundClient = {
  get: vi.fn(),
  set: vi.fn(),
  reset: vi.fn(),
};
const createInterviewApiClient = vi.fn(() => apiClient);
const createPlaygroundControlClient = vi.fn(() => playgroundClient);
const readConfig = vi.fn();

vi.mock("@omnitech/interview-api-client", () => ({
  createInterviewApiClient,
}));
vi.mock("@omnitech/interview-playground-control", () => ({
  createPlaygroundControlClient,
}));
vi.mock("./config.js", () => ({
  configPath: "/tmp/config.json",
  readConfig,
  writeConfig: vi.fn(),
}));

const { createConfiguredClient, createConfiguredPlaygroundControlClient } =
  await import("./index.js");

beforeEach(() => {
  vi.clearAllMocks();
  readConfig.mockResolvedValue({});
  delete process.env["INTERVIEW_API_URL"];
  delete process.env["INTERVIEW_API_TOKEN"];
});

describe("createConfiguredClient", () => {
  it("uses explicit options before environment and file configuration", async () => {
    process.env["INTERVIEW_API_URL"] = "http://environment";
    process.env["INTERVIEW_API_TOKEN"] = "environment-token";
    readConfig.mockResolvedValue({
      url: "http://config",
      token: "config-token",
    });

    await createConfiguredClient({
      url: "http://option",
      token: "option-token",
      tenant: "acme",
    });

    expect(createInterviewApiClient).toHaveBeenCalledWith({
      baseUrl: "http://option",
      tenant: "acme",
      token: "option-token",
    });
  });

  it("falls back through environment, config, and the local default", async () => {
    process.env["INTERVIEW_API_URL"] = "http://environment";
    await createConfiguredClient();
    expect(createInterviewApiClient).toHaveBeenLastCalledWith({
      baseUrl: "http://environment",
      tenant: "local",
    });

    delete process.env["INTERVIEW_API_URL"];
    readConfig.mockResolvedValue({ url: "http://config" });
    await createConfiguredClient();
    expect(createInterviewApiClient).toHaveBeenLastCalledWith({
      baseUrl: "http://config",
      tenant: "local",
    });

    readConfig.mockResolvedValue({});
    await createConfiguredClient();
    expect(createInterviewApiClient).toHaveBeenLastCalledWith({
      baseUrl: "http://127.0.0.1:3000",
      tenant: "local",
    });
  });

  it("normalizes optional language, stdin, and notes", async () => {
    const client = await createConfiguredClient();

    await client.generate({ question: "Solve it" });
    await client.route({ question: "Route it" });
    await client.run({ language: "php", code: "<?php" });
    await client.saveAnswer({
      title: "Answer",
      language: "php",
      answerMarkdown: "Explanation",
      guide,
      code: "<?php",
      usageCode: "echo 'usage';",
      testCode: "",
      question: "Question",
    });

    expect(apiClient.generate).toHaveBeenCalledWith({
      question: "Solve it",
      language: "auto",
    });
    expect(apiClient.route).toHaveBeenCalledWith({
      question: "Route it",
      language: "auto",
    });
    expect(apiClient.run).toHaveBeenCalledWith({
      language: "php",
      code: "<?php",
      stdin: "",
    });
    expect(apiClient.saveAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ notes: "" }),
    );
  });

  it("delegates read and delete operations unchanged", async () => {
    const client = await createConfiguredClient();

    await client.health();
    await client.listAnswers();
    await client.getAnswer("answer-id");
    await client.deleteAnswer("answer-id");

    expect(apiClient.health).toHaveBeenCalledOnce();
    expect(apiClient.listAnswers).toHaveBeenCalledOnce();
    expect(apiClient.getAnswer).toHaveBeenCalledWith("answer-id");
    expect(apiClient.deleteAnswer).toHaveBeenCalledWith("answer-id");
  });
});

describe("createConfiguredPlaygroundControlClient", () => {
  it("shares configuration precedence with the live control SDK", async () => {
    process.env["INTERVIEW_API_TOKEN"] = "environment-token";
    readConfig.mockResolvedValue({ url: "http://config" });

    await expect(createConfiguredPlaygroundControlClient()).resolves.toBe(
      playgroundClient,
    );
    expect(createPlaygroundControlClient).toHaveBeenCalledWith({
      baseUrl: "http://config",
      token: "environment-token",
    });
  });

  it("defaults to the local web app", async () => {
    delete process.env["INTERVIEW_API_TOKEN"];
    delete process.env["INTERVIEW_API_URL"];
    readConfig.mockResolvedValue({});
    await createConfiguredPlaygroundControlClient();
    expect(createPlaygroundControlClient).toHaveBeenLastCalledWith({
      baseUrl: "http://127.0.0.1:3000",
    });
  });
});
