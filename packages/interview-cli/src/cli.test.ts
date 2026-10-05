import { readFile } from "node:fs/promises";

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
  generate: vi.fn(),
  explain: vi.fn(),
  saveExplanation: vi.fn(),
  saveAnswer: vi.fn(),
  listAnswers: vi.fn(),
  health: vi.fn(),
  route: vi.fn(),
  getAnswer: vi.fn(),
  run: vi.fn(),
};
const playgroundClient = {
  appendExplanation: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  reset: vi.fn(),
};
const createConfiguredClient = vi.fn(async () => apiClient);
const createConfiguredPlaygroundControlClient = vi.fn(
  async () => playgroundClient,
);
const briefingClient = {
  listProfiles: vi.fn(),
  importProfile: vi.fn(),
  getProfile: vi.fn(),
  listArtifacts: vi.fn(),
  getArtifact: vi.fn(),
  editArtifact: vi.fn(),
  propose: vi.fn(),
  apply: vi.fn(),
  save: vi.fn(),
};
const createConfiguredBriefingClient = vi.fn(async () => briefingClient);
const writeConfig = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));
vi.mock("./config", () => ({
  configPath: "/tmp/interview-config.json",
  writeConfig,
}));
vi.mock("./index", () => ({
  createConfiguredClient,
  createConfiguredPlaygroundControlClient,
  createConfiguredBriefingClient,
}));

const { createProgram } = await import("./cli");

async function run(...arguments_: string[]) {
  await createProgram().exitOverride().parseAsync(arguments_, { from: "user" });
}

describe("interview-answers CLI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  it("imports a profile from an explicit JSON file with the configured tenant", async () => {
    vi.mocked(readFile).mockResolvedValueOnce('{"candidate":{},"roles":[]}');
    briefingClient.importProfile.mockResolvedValue({ id: "p", revision: 1 });
    await run(
      "--format",
      "json",
      "briefing",
      "--tenant",
      "team-a",
      "import",
      "--file",
      "matrix.json",
      "--name",
      "Candidate",
    );
    expect(createConfiguredBriefingClient).toHaveBeenCalledWith({
      format: "json",
      tenant: "team-a",
    });
    expect(briefingClient.importProfile).toHaveBeenCalledWith({
      name: "Candidate",
      matrix: { candidate: {}, roles: [] },
    });
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('"revision": 1'),
    );
  });

  it("lists and shows briefing resources without mutating them", async () => {
    briefingClient.listProfiles.mockResolvedValue({
      profiles: [{ id: "p", revision: 1 }],
    });
    briefingClient.getProfile.mockResolvedValue({ id: "p", revision: 1 });
    briefingClient.listArtifacts.mockResolvedValue({
      artifacts: [{ id: "a" }],
    });
    briefingClient.getArtifact.mockResolvedValue({
      origin: { artifactId: "a" },
    });

    await run("briefing", "profiles");
    await run("briefing", "show", "--id", "p", "--revision", "1");
    await run("briefing", "artifacts");
    await run("briefing", "show", "--id", "a");

    expect(briefingClient.listProfiles).toHaveBeenCalledOnce();
    expect(briefingClient.getProfile).toHaveBeenCalledWith("p", 1);
    expect(briefingClient.listArtifacts).toHaveBeenCalledOnce();
    expect(briefingClient.getArtifact).toHaveBeenCalledWith("a");
    expect(briefingClient.editArtifact).not.toHaveBeenCalled();
    expect(briefingClient.apply).not.toHaveBeenCalled();
    expect(briefingClient.save).not.toHaveBeenCalled();
  });

  it("edits from a validated file and opens preparation separately", async () => {
    const input = {
      expectedRevision: 2,
      briefing: {
        kind: "non-technical-briefing",
        title: "Preparation",
        context: {
          company: "Acme",
          role: "Engineer",
          stage: "recruiter",
          profile: { id: "p", revision: 1 },
        },
        questions: [],
      },
    };
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(input));
    briefingClient.editArtifact.mockResolvedValue({
      origin: { artifactId: "a" },
    });
    playgroundClient.set.mockResolvedValue({
      value: { view: "interview-preparation" },
    });

    await run("briefing", "edit", "--id", "a", "--file", "draft.json");
    await run("briefing", "open");

    expect(readFile).toHaveBeenCalledWith("draft.json", "utf8");
    expect(briefingClient.editArtifact).toHaveBeenCalledWith("a", input);
    expect(playgroundClient.set).toHaveBeenCalledWith({
      view: "interview-preparation",
    });
    expect(briefingClient.apply).not.toHaveBeenCalled();
    expect(briefingClient.save).not.toHaveBeenCalled();
  });

  it("rejects invalid show and apply revisions before their requests", async () => {
    await expect(
      run("briefing", "show", "--id", "p", "--revision", "NaN"),
    ).rejects.toThrow("Revision must be a non-negative integer.");
    await expect(
      run(
        "briefing",
        "apply",
        "--id",
        "a",
        "--proposal",
        "p",
        "--revision",
        "-1",
      ),
    ).rejects.toThrow("Revision must be a non-negative integer.");
    expect(briefingClient.getProfile).not.toHaveBeenCalled();
    expect(briefingClient.apply).not.toHaveBeenCalled();
  });

  it("keeps propose, apply, and save as separate commands", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        expectedRevision: 2,
        context: {
          company: "A",
          role: "B",
          stage: "recruiter",
          profile: { id: "p", revision: 1 },
        },
        questions: [{ id: "q", question: "Why?", category: "motivation" }],
      }),
    );
    briefingClient.propose.mockResolvedValue({ id: "proposal" });
    await run(
      "briefing",
      "propose",
      "--id",
      "artifact",
      "--file",
      "proposal.json",
    );
    expect(briefingClient.propose).toHaveBeenCalledOnce();
    expect(briefingClient.apply).not.toHaveBeenCalled();
    expect(briefingClient.save).not.toHaveBeenCalled();

    await run(
      "briefing",
      "apply",
      "--id",
      "artifact",
      "--proposal",
      "proposal",
      "--revision",
      "2",
    );
    expect(briefingClient.apply).toHaveBeenCalledWith("artifact", {
      proposalId: "proposal",
      expectedRevision: 2,
    });
    expect(briefingClient.save).not.toHaveBeenCalled();

    await run(
      "briefing",
      "save",
      "--id",
      "artifact",
      "--revision",
      "3",
      "--request-id",
      "request",
    );
    expect(briefingClient.save).toHaveBeenCalledWith("artifact", {
      expectedRevision: 3,
      requestId: "request",
    });
  });

  it("rejects invalid CLI revisions before a briefing mutation", async () => {
    await expect(
      run(
        "briefing",
        "save",
        "--id",
        "artifact",
        "--revision",
        "1.5",
        "--request-id",
        "request",
      ),
    ).rejects.toThrow("Revision must be a non-negative integer.");
    expect(briefingClient.save).not.toHaveBeenCalled();
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
      "--tenant",
      "acme",
    );

    expect(createConfiguredClient).toHaveBeenCalledWith({
      url: "http://api",
      format: "json",
      tenant: "acme",
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

  it("explains a topic, opens Concept Lab, and optionally saves", async () => {
    apiClient.explain.mockResolvedValue({
      title: "React hooks",
      markdown: "## Talking points",
    });
    apiClient.saveExplanation.mockResolvedValue({
      id: "saved",
      title: "React hooks",
      markdown: "## Talking points",
      topic: "React hooks",
    });
    playgroundClient.set.mockResolvedValue({});

    await run("explain", "--topic", "React hooks", "--save");

    expect(createConfiguredClient).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: "local" }),
    );
    expect(apiClient.explain).toHaveBeenCalledWith({ topic: "React hooks" });
    expect(apiClient.saveExplanation).toHaveBeenCalledWith({
      title: "React hooks",
      markdown: "## Talking points",
      topic: "React hooks",
    });
    expect(playgroundClient.set).toHaveBeenCalledWith({
      view: "concept-lab",
      explanation: {
        topic: "React hooks",
        title: "React hooks",
        markdown: "## Talking points",
      },
    });
  });

  it("explains file input with context without saving", async () => {
    vi.mocked(readFile).mockResolvedValueOnce("System design");
    apiClient.explain.mockResolvedValue({
      title: "System design",
      markdown: "Brief",
    });
    playgroundClient.set.mockResolvedValue({});
    await run(
      "explain",
      "--file",
      "topic.md",
      "--context",
      "Backend interview",
    );
    expect(apiClient.explain).toHaveBeenCalledWith({
      topic: "System design",
      context: "Backend interview",
    });
    expect(apiClient.saveExplanation).not.toHaveBeenCalled();
  });

  it("appends a generated explanation to the current Concept Lab session", async () => {
    apiClient.explain.mockResolvedValue({
      title: "Cache expiry",
      markdown: "Expire stale entries.",
    });
    playgroundClient.appendExplanation.mockResolvedValue({});

    await run("explain", "--topic", "Cache follow-up", "--append");

    expect(playgroundClient.appendExplanation).toHaveBeenCalledWith({
      topic: "Cache follow-up",
      title: "Cache expiry",
      markdown: "Expire stale entries.",
    });
    expect(playgroundClient.set).not.toHaveBeenCalled();
  });

  it("reads questions and save payloads from files", async () => {
    vi.mocked(readFile)
      .mockResolvedValueOnce("Question from file")
      .mockResolvedValueOnce(
        JSON.stringify({
          title: "PHP answer",
          language: "php",
          code: "<?php",
          testCode: "",
          question: "Question",
          notes: "",
          guide,
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

  it("prints a concise playground summary", async () => {
    playgroundClient.get.mockResolvedValue({
      value: {
        view: "concept-lab",
        explanation: { title: "React rendering" },
      },
    });

    await run("playground", "show", "--summary");

    expect(process.stdout.write).toHaveBeenCalledWith(
      "concept-lab: React rendering\n",
    );
  });

  it("starts, shows, ends, and resets the Mock Interview workspace", async () => {
    playgroundClient.set.mockResolvedValue({});
    playgroundClient.get.mockResolvedValue({});

    await run("mock-interview", "start", "--strict");
    await run("mock-interview", "show");
    await run("mock-interview", "end");
    await run("mock-interview", "reset");

    expect(playgroundClient.set).toHaveBeenNthCalledWith(1, {
      view: "mock-interview",
      mockInterview: { action: "start", strict: true },
    });
    expect(playgroundClient.get).toHaveBeenCalledOnce();
    expect(playgroundClient.set).toHaveBeenNthCalledWith(2, {
      view: "mock-interview",
      mockInterview: { action: "end", strict: false },
    });
    expect(playgroundClient.set).toHaveBeenNthCalledWith(3, {
      view: "mock-interview",
      mockInterview: { action: "reset", strict: false },
    });
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

  it("can patch playground controls without printing the state", async () => {
    playgroundClient.set.mockResolvedValue({ value: { view: "concept-lab" } });

    await run("playground", "set", "--view", "concept-lab", "--quiet");

    expect(playgroundClient.set).toHaveBeenCalledWith({ view: "concept-lab" });
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it("appends a prepared explanation from a Markdown file", async () => {
    vi.mocked(readFile).mockResolvedValueOnce("Follow-up answer");
    playgroundClient.appendExplanation.mockResolvedValue({});

    await run(
      "playground",
      "append-explanation",
      "--topic",
      "Race safety",
      "--title",
      "Request generations",
      "--markdown-file",
      "follow-up.md",
    );

    expect(playgroundClient.appendExplanation).toHaveBeenCalledWith({
      topic: "Race safety",
      title: "Request generations",
      markdown: "Follow-up answer",
    });
  });

  it("sets a complete answer from code files", async () => {
    vi.mocked(readFile)
      .mockResolvedValueOnce("export function Counter() {}")
      .mockResolvedValueOnce("test('counter', () => {})")
      .mockResolvedValueOnce(JSON.stringify(guide));
    playgroundClient.set.mockResolvedValue({});

    await run(
      "playground",
      "set",
      "--language",
      "react",
      "--title",
      "Counter",
      "--guide-file",
      "guide.json",
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
        answerMarkdown: "",
        code: "export function Counter() {}",
        usageCode: "",
        testCode: "test('counter', () => {})",
        guide,
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
