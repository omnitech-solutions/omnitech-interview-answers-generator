import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: childProcessMocks.spawn,
}));

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
});
