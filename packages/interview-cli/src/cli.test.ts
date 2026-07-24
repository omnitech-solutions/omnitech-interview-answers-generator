import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiClient = {
  generate: vi.fn(),
  saveAnswer: vi.fn(),
  listAnswers: vi.fn(),
  health: vi.fn(),
  route: vi.fn(),
  getAnswer: vi.fn(),
  run: vi.fn(),
};
const playgroundClient = {
  get: vi.fn(),
  set: vi.fn(),
  reset: vi.fn(),
};
const createConfiguredClient = vi.fn(async () => apiClient);
const createConfiguredPlaygroundControlClient = vi.fn(
  async () => playgroundClient,
);
const writeConfig = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));
vi.mock("./config.js", () => ({
  configPath: "/tmp/interview-config.json",
  writeConfig,
}));
vi.mock("./index.js", () => ({
  createConfiguredClient,
  createConfiguredPlaygroundControlClient,
}));

const { createProgram } = await import("./cli.js");

async function run(...arguments_: string[]) {
  await createProgram().exitOverride().parseAsync(arguments_, { from: "user" });
}

describe("interview-answers CLI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  it("configures the CLI", async () => {
    await run("configure", "--url", "http://localhost:3000", "--token", "x");

    expect(writeConfig).toHaveBeenCalledWith({
      url: "http://localhost:3000",
      token: "x",
    });
    expect(process.stdout.write).toHaveBeenCalledWith(
      "Saved CLI configuration to /tmp/interview-config.json\n",
    );
  });

  it("asks, saves, and prints JSON when requested", async () => {
    const answer = {
      title: "Counter",
      language: "react",
      answerMarkdown: "Answer",
      code: "code",
      testCode: "tests",
    };
    apiClient.generate.mockResolvedValue(answer);
    apiClient.saveAnswer.mockResolvedValue({ ...answer, id: "saved" });

    await run(
      "--url",
      "http://api",
      "--format",
      "json",
      "ask",
      "--question",
      "Build a counter",
      "--language",
      "react",
      "--save",
      "--notes",
      "note",
    );

    expect(createConfiguredClient).toHaveBeenCalledWith({
      url: "http://api",
      format: "json",
    });
    expect(apiClient.generate).toHaveBeenCalledWith({
      question: "Build a counter",
      language: "react",
    });
    expect(apiClient.saveAnswer).toHaveBeenCalledWith({
      ...answer,
      question: "Build a counter",
      notes: "note",
    });
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('"id": "saved"'),
    );
  });

  it("reads questions and save payloads from files", async () => {
    vi.mocked(readFile)
      .mockResolvedValueOnce("Question from file")
      .mockResolvedValueOnce(
        JSON.stringify({
          title: "PHP answer",
          language: "php",
          answerMarkdown: "Explanation",
          code: "<?php",
          testCode: "",
          question: "Question",
          notes: "",
        }),
      );
    apiClient.generate.mockResolvedValue({
      answerMarkdown: "Generated",
    });
    apiClient.saveAnswer.mockResolvedValue({ answerMarkdown: "Saved" });

    await run("ask", "--file", "question.txt");
    await run("save", "--file", "answer.json");

    expect(readFile).toHaveBeenNthCalledWith(1, "question.txt", "utf8");
    expect(apiClient.generate).toHaveBeenCalledWith({
      question: "Question from file",
      language: "auto",
    });
    expect(apiClient.saveAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ title: "PHP answer" }),
    );
  });

  it("lists answers using the readable table format", async () => {
    apiClient.listAnswers.mockResolvedValue([
      { id: "one", language: "php", title: "First" },
      { id: "two", language: "react", title: "Second" },
    ]);

    await run("list");

    expect(process.stdout.write).toHaveBeenCalledWith("one\tphp\tFirst\n");
    expect(process.stdout.write).toHaveBeenCalledWith("two\treact\tSecond\n");
  });

  it.each([
    ["health", "health", undefined],
    ["route", "route", { question: "route me", language: "php" }],
    ["show", "getAnswer", "answer-id"],
  ] as const)("executes %s", async (command, method, expected) => {
    apiClient[method].mockResolvedValue({ code: "result" });
    const commandArguments =
      command === "route"
        ? ["route", "--question", "route me", "--language", "php"]
        : command === "show"
          ? ["show", "answer-id"]
          : ["health"];

    await run(...commandArguments);

    if (expected === undefined) {
      expect(apiClient[method]).toHaveBeenCalledWith();
    } else {
      expect(apiClient[method]).toHaveBeenCalledWith(expected);
    }
    expect(process.stdout.write).toHaveBeenCalledWith("result\n");
  });

  it("runs inline code with stdin", async () => {
    apiClient.run.mockResolvedValue({ code: "executed" });

    await run(
      "run",
      "--language",
      "php",
      "--code",
      "<?php echo 1;",
      "--stdin",
      "input",
    );

    expect(apiClient.run).toHaveBeenCalledWith({
      language: "php",
      code: "<?php echo 1;",
      stdin: "input",
    });
  });

  it("shows and resets the playground", async () => {
    playgroundClient.get.mockResolvedValue({ question: "Current" });
    playgroundClient.reset.mockResolvedValue({ question: "" });

    await run("playground", "show");
    await run("playground", "reset");

    expect(playgroundClient.get).toHaveBeenCalledOnce();
    expect(playgroundClient.reset).toHaveBeenCalledOnce();
  });

  it("patches named playground controls", async () => {
    playgroundClient.set.mockResolvedValue({ question: "Counter" });

    await run(
      "playground",
      "set",
      "--question",
      "Counter",
      "--language",
      "react",
      "--notes",
      "Use updater",
      "--panel",
      "notes",
    );

    expect(playgroundClient.set).toHaveBeenCalledWith({
      question: "Counter",
      language: "react",
      notes: "Use updater",
      panel: "notes",
    });
  });

  it("sets a complete answer from code files", async () => {
    vi.mocked(readFile)
      .mockResolvedValueOnce("export function Counter() {}")
      .mockResolvedValueOnce("test('counter', () => {})");
    playgroundClient.set.mockResolvedValue({});

    await run(
      "playground",
      "set",
      "--language",
      "react",
      "--title",
      "Counter",
      "--answer-markdown",
      "Explanation",
      "--code-file",
      "answer.tsx",
      "--test-code-file",
      "answer.test.tsx",
    );

    expect(playgroundClient.set).toHaveBeenCalledWith({
      language: "react",
      answer: {
        title: "Counter",
        language: "react",
        answerMarkdown: "Explanation",
        code: "export function Counter() {}",
        usageCode: "",
        testCode: "test('counter', () => {})",
      },
    });
  });

  it("loads a playground patch from JSON", async () => {
    vi.mocked(readFile).mockResolvedValue('{"question":"From JSON"}');
    playgroundClient.set.mockResolvedValue({});

    await run("playground", "set", "--file", "patch.json");

    expect(playgroundClient.set).toHaveBeenCalledWith({
      question: "From JSON",
    });
  });

  it("clears an answer and rejects conflicting answer options", async () => {
    playgroundClient.set.mockResolvedValue({});

    await run("playground", "set", "--clear-answer");
    expect(playgroundClient.set).toHaveBeenCalledWith({ answer: null });

    await expect(
      run("playground", "set", "--clear-answer", "--title", "Conflict"),
    ).rejects.toThrow(
      "--clear-answer cannot be combined with answer field options.",
    );
  });

  it("rejects incomplete answers and missing run code", async () => {
    await expect(
      run("playground", "set", "--title", "Incomplete"),
    ).rejects.toThrow("An answer requires");
    await expect(run("run", "--language", "php")).rejects.toThrow(
      "Provide --file or --code.",
    );
  });
});
