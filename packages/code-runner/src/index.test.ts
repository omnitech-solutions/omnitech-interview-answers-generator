import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
  mkdtemp: vi.fn().mockResolvedValue("/tmp/interview-answer-run-test"),
  rm: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
  // No report by default: the run falls back to its plain output.
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
}));

vi.mock("node:child_process", () => ({
  spawn: childProcessMocks.spawn,
}));

vi.mock("node:fs/promises", () => fsMocks);

import { DockerCodeRunner } from "./index.js";

function createChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    stderr: EventEmitter;
    stdin: { end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
  };

  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn() };
  child.kill = vi.fn();
  childProcessMocks.spawn.mockReturnValue(child);

  return child;
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("DockerCodeRunner", () => {
  it.each([
    {
      language: "php" as const,
      image: "php:8.3-cli-alpine",
      runtimeArguments: ["php", "-r"],
      code: "<?php echo 'ready'; ?>",
      expectedCode: "echo 'ready'; ",
    },
    {
      language: "ruby" as const,
      image: "ruby:3.4-alpine",
      runtimeArguments: ["ruby", "-e"],
      code: "puts 'ready'",
      expectedCode: "puts 'ready'",
    },
    {
      language: "typescript" as const,
      image: "node:22-alpine",
      runtimeArguments: ["node", "--experimental-strip-types", "-e"],
      code: "console.log('ready')",
      expectedCode: "console.log('ready')",
    },
  ])(
    "runs $language in the expected isolated container",
    async ({ language, image, runtimeArguments, code, expectedCode }) => {
      const child = createChildProcess();
      const runner = new DockerCodeRunner({ dockerBinary: "podman" });

      const resultPromise = runner.run({ language, code, stdin: "input" });

      expect(childProcessMocks.spawn).toHaveBeenCalledWith(
        "podman",
        [
          "run",
          "--rm",
          "--interactive",
          "--network",
          "none",
          "--memory",
          "128m",
          "--cpus",
          "0.5",
          "--pids-limit",
          "64",
          "--read-only",
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,size=16m",
          "--security-opt",
          "no-new-privileges",
          image,
          ...runtimeArguments,
          expectedCode,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      expect(child.stdin.end).toHaveBeenCalledWith("input");

      child.emit("close", 0);

      await expect(resultPromise).resolves.toEqual(
        expect.objectContaining({
          exitCode: 0,
          stderr: "",
          stdout: "",
          timedOut: false,
        }),
      );
    },
  );

  it("removes PHP tags from every normal-output section", async () => {
    const child = createChildProcess();
    const runner = new DockerCodeRunner({ dockerBinary: "podman" });

    const resultPromise = runner.run({
      language: "php",
      code: "<?php function solution(): int { return 1; }\n\n<?php echo solution(); ?>",
      stdin: "",
    });

    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      "podman",
      expect.arrayContaining([
        "php:8.3-cli-alpine",
        "-r",
        "function solution(): int { return 1; }\n\necho solution(); ",
      ]),
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    child.emit("close", 0);
    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({ exitCode: 0 }),
    );
  });

  it("keeps usage output out of the test source", async () => {
    const child = createChildProcess();
    const runner = new DockerCodeRunner({ dockerBinary: "podman" });

    const resultPromise = runner.runAll({
      language: "ruby",
      code: "solution",
      usageCode: "puts 'normal output'",
      testCode: "RSpec.describe { it { expect(true).to be(true) } }",
      stdin: "",
    });

    await vi.waitFor(() => expect(fsMocks.writeFile).toHaveBeenCalled());
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "/tmp/interview-answer-run-test/solution_spec.rb",
      "solution\n\nRSpec.describe { it { expect(true).to be(true) } }",
      { mode: 0o600 },
    );

    child.emit("close", 0);
    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({ exitCode: 0, timedOut: false }),
    );
  });

  it("normalizes duplicate PHP opening tags before Pest runs", async () => {
    const child = createChildProcess();
    const runner = new DockerCodeRunner({ dockerBinary: "podman" });

    const resultPromise = runner.runAll({
      language: "php",
      code: "<?php\nfunction solution(): int { return 1; }",
      usageCode: "",
      testCode: "<?php\nit('works', fn () => expect(solution())->toBe(1));",
      stdin: "",
    });

    await vi.waitFor(() => expect(fsMocks.writeFile).toHaveBeenCalled());
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "/tmp/interview-answer-run-test/SolutionTest.php",
      "<?php\nfunction solution(): int { return 1; }\n\nit('works', fn () => expect(solution())->toBe(1));",
      { mode: 0o600 },
    );

    child.emit("close", 0);
    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({ exitCode: 0, timedOut: false }),
    );
  });

  it.each([
    ["typescript", "solution.ts"],
    ["react", "solution.tsx"],
  ] as const)(
    "uses the TypeScript parser for %s",
    async (language, filename) => {
      const child = createChildProcess();
      const runner = new DockerCodeRunner({ dockerBinary: "podman" });

      const resultPromise = runner.checkSyntax({
        language,
        code: "valid source",
      });
      await vi.waitFor(() =>
        expect(childProcessMocks.spawn).toHaveBeenCalled(),
      );

      const [, dockerArguments] = childProcessMocks.spawn.mock.calls[0] as [
        string,
        string[],
      ];
      expect(dockerArguments).toEqual(
        expect.arrayContaining(["node", "--input-type=module", "-e"]),
      );
      expect(dockerArguments).toContainEqual(
        expect.stringMatching(new RegExp(`/workspace/${filename}:ro$`)),
      );

      child.emit("close", 0);
      await expect(resultPromise).resolves.toEqual(
        expect.objectContaining({ exitCode: 0, timedOut: false }),
      );
    },
  );

  it.each([
    ["php", "solution.php", ["php", "-l", "/workspace/solution.php"]],
    ["ruby", "solution.rb", ["ruby", "-c", "/workspace/solution.rb"]],
  ] as const)(
    "uses the native syntax checker for %s",
    async (language, filename, command) => {
      const child = createChildProcess();
      const runner = new DockerCodeRunner({ dockerBinary: "podman" });

      const resultPromise = runner.checkSyntax({
        language,
        code: "valid source",
      });
      await vi.waitFor(() =>
        expect(childProcessMocks.spawn).toHaveBeenCalled(),
      );

      const [, dockerArguments] = childProcessMocks.spawn.mock.calls[0] as [
        string,
        string[],
      ];
      expect(dockerArguments).toEqual(expect.arrayContaining([...command]));
      expect(dockerArguments).toContain("--volume");
      expect(dockerArguments).toContainEqual(
        expect.stringMatching(new RegExp(`/workspace/${filename}:ro$`)),
      );

      child.emit("close", 0);
      await expect(resultPromise).resolves.toEqual(
        expect.objectContaining({ exitCode: 0, timedOut: false }),
      );
    },
  );

  it("writes PHP syntax checks as executable PHP source", async () => {
    const child = createChildProcess();
    const runner = new DockerCodeRunner({ dockerBinary: "podman" });

    const resultPromise = runner.checkSyntax({
      language: "php",
      code: "function solution(array $timestamps, int $window: int",
    });

    await vi.waitFor(() => expect(fsMocks.writeFile).toHaveBeenCalled());
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      "/tmp/interview-answer-run-test/solution.php",
      "<?php\nfunction solution(array $timestamps, int $window: int",
      { mode: 0o600 },
    );

    child.emit("close", 1);
    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({ exitCode: 1, timedOut: false }),
    );
  });

  it("captures stdout and stderr and preserves a nonzero exit code", async () => {
    const child = createChildProcess();
    const runner = new DockerCodeRunner();

    const resultPromise = runner.run({
      language: "typescript",
      code: "throw new Error('broken')",
      stdin: "",
    });
    child.stdout.emit("data", Buffer.from("before failure\n"));
    child.stderr.emit("data", Buffer.from("Error: broken\n"));
    child.emit("close", 1);

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({
        exitCode: 1,
        stdout: "before failure\n",
        stderr: "Error: broken\n",
        timedOut: false,
      }),
    );
  });

  it("bounds stdout and stderr independently", async () => {
    const child = createChildProcess();
    const runner = new DockerCodeRunner({ maxOutputBytes: 5 });

    const resultPromise = runner.run({
      language: "ruby",
      code: "puts 'output'",
      stdin: "",
    });
    child.stdout.emit("data", Buffer.from("abc"));
    child.stdout.emit("data", Buffer.from("def"));
    child.stderr.emit("data", Buffer.from("123456"));
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({
        stdout: "abcde",
        stderr: "12345",
      }),
    );
  });

  it("kills a process that exceeds its configured timeout", async () => {
    vi.useFakeTimers();
    const child = createChildProcess();
    const runner = new DockerCodeRunner({ timeoutMs: 25 });

    const resultPromise = runner.run({
      language: "php",
      code: "while (true) {}",
      stdin: "",
    });

    await vi.advanceTimersByTimeAsync(25);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({
        exitCode: null,
        timedOut: true,
      }),
    );
  });

  it("rejects when the container process cannot be started", async () => {
    vi.useFakeTimers();
    const child = createChildProcess();
    const runner = new DockerCodeRunner();
    const error = new Error("docker is unavailable");

    const resultPromise = runner.run({
      language: "php",
      code: "echo 'ready';",
      stdin: "",
    });
    child.emit("error", error);

    await expect(resultPromise).rejects.toBe(error);
    vi.clearAllTimers();
  });

  it("rejects when Docker starts but its daemon is unavailable", async () => {
    const child = createChildProcess();
    const runner = new DockerCodeRunner();

    const resultPromise = runner.run({
      language: "ruby",
      code: "puts 'ready'",
      stdin: "",
    });
    child.stderr.emit(
      "data",
      Buffer.from(
        "Cannot connect to the Docker daemon at unix:///tmp/docker.sock. Is the docker daemon running?",
      ),
    );
    child.emit("close", 1);

    await expect(resultPromise).rejects.toThrow(
      "Docker daemon is unavailable.",
    );
  });

  it.each([
    {
      language: "ruby" as const,
      image: "omnitech/rspec-runner:latest",
      filename: "solution_spec.rb",
      command: ["rspec", "--format", "documentation"],
    },
    {
      language: "php" as const,
      image: "omnitech/pest-runner:latest",
      filename: "SolutionTest.php",
      command: [
        "/runner/vendor/bin/pest",
        "--colors=never",
        "--no-coverage",
        "--do-not-cache-result",
      ],
    },
    {
      language: "typescript" as const,
      image: "omnitech/vitest-runner:latest",
      filename: "solution.test.ts",
      command: [
        "/runner/node_modules/.bin/vitest",
        "run",
        "--environment",
        "node",
        "--reporter",
        "verbose",
      ],
    },
    {
      language: "react" as const,
      image: "omnitech/vitest-runner:latest",
      filename: "solution.test.tsx",
      command: [
        "/runner/node_modules/.bin/vitest",
        "run",
        "--environment",
        "jsdom",
        "--reporter",
        "verbose",
      ],
    },
  ])(
    "runs $language tests with the dedicated framework image",
    async ({ language, image, filename, command }) => {
      const child = createChildProcess();
      const runner = new DockerCodeRunner({ dockerBinary: "podman" });

      const resultPromise = runner.runAll({
        language,
        code: "solution",
        usageCode: "usage",
        testCode: "tests",
        stdin: "",
      });
      await vi.waitFor(() =>
        expect(childProcessMocks.spawn).toHaveBeenCalled(),
      );

      const [, dockerArguments] = childProcessMocks.spawn.mock.calls[0] as [
        string,
        string[],
      ];
      expect(dockerArguments).toEqual(
        expect.arrayContaining([
          "--volume",
          expect.stringMatching(
            new RegExp(`:${`/workspace/${filename}`.replace(".", "\\.")}:ro$`),
          ),
          image,
          ...command,
          `/workspace/${filename}`,
        ]),
      );
      expect(child.stdin.end).toHaveBeenCalledWith("");

      child.emit("close", 0);
      await expect(resultPromise).resolves.toEqual(
        expect.objectContaining({ exitCode: 0, timedOut: false }),
      );
    },
  );

  it("fails a PHP run when Pest discovers no tests", async () => {
    const child = createChildProcess();
    const runner = new DockerCodeRunner({ dockerBinary: "podman" });

    const resultPromise = runner.runAll({
      language: "php",
      code: "function solution(): int { return 1; }",
      usageCode: "",
      testCode: "print 'All tests passed.';",
      stdin: "",
    });
    await vi.waitFor(() => expect(childProcessMocks.spawn).toHaveBeenCalled());

    child.stdout.emit(
      "data",
      Buffer.from("INFO  All tests passed.\n\nINFO  No tests found.\n"),
    );
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({
        exitCode: 1,
        stderr: expect.stringContaining(
          "completed without discovering any tests",
        ),
      }),
    );
  });

  it("runs solution and usage without invoking a test framework when tests are empty", async () => {
    const child = createChildProcess();
    const runner = new DockerCodeRunner({ dockerBinary: "podman" });

    const resultPromise = runner.runAll({
      language: "php",
      code: "<?php echo 'solution';",
      usageCode: "echo 'usage';",
      testCode: "",
      stdin: "",
    });

    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      "podman",
      expect.arrayContaining([
        "php:8.3-cli-alpine",
        "-r",
        "echo 'solution';\n\necho 'usage';",
      ]),
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    expect(child.stdin.end).toHaveBeenCalledWith("");

    child.emit("close", 0);
    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({ exitCode: 0, timedOut: false }),
    );
  });
});

describe("DockerCodeRunner per-test results", () => {
  it("reads the framework's report from the one writable mount", async () => {
    vi.useFakeTimers();
    const child = createChildProcess();
    fsMocks.readFile.mockResolvedValueOnce(
      JSON.stringify({
        testResults: [
          {
            assertionResults: [
              {
                ancestorTitles: [],
                title: "adds",
                status: "passed",
                duration: 1,
                location: { line: 3 },
              },
            ],
          },
        ],
      }),
    );
    const runner = new DockerCodeRunner();
    const resultPromise = runner.runAll({
      language: "typescript",
      code: "solution",
      usageCode: "",
      testCode: "tests",
      stdin: "",
    });
    await vi.waitFor(() => expect(childProcessMocks.spawn).toHaveBeenCalled());
    const [, dockerArguments] = childProcessMocks.spawn.mock.calls[0] as [
      string,
      string[],
    ];
    expect(dockerArguments).toContain(
      "/tmp/interview-answer-run-test/out:/out:rw",
    );
    expect(dockerArguments).toEqual(
      expect.arrayContaining(["--outputFile.json", "/out/report.json"]),
    );
    expect(fsMocks.chmod).toHaveBeenCalledWith(
      "/tmp/interview-answer-run-test/out",
      0o777,
    );
    // Test runs get longer than the plain 5s budget.
    vi.advanceTimersByTime(6_000);
    expect(child.kill).not.toHaveBeenCalled();
    child.emit("close", 0);
    await expect(resultPromise).resolves.toMatchObject({
      tests: [
        {
          name: "adds",
          status: "passed",
          location: { editor: "tests", line: 1 },
        },
      ],
    });
    expect(fsMocks.readFile).toHaveBeenCalledWith(
      "/tmp/interview-answer-run-test/out/report.json",
      "utf8",
    );
  });

  it("places syntax problems from the checker's output", async () => {
    const child = createChildProcess();
    const runner = new DockerCodeRunner();
    const resultPromise = runner.checkSyntax({
      language: "typescript",
      code: "const a = ;",
    });
    await vi.waitFor(() => expect(childProcessMocks.spawn).toHaveBeenCalled());
    child.stderr.emit("data", Buffer.from("1:11: Expression expected.\n"));
    child.emit("close", 1);
    await expect(resultPromise).resolves.toMatchObject({
      diagnostics: [{ line: 1, column: 11, message: "Expression expected." }],
    });
  });
});
