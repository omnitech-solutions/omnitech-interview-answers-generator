import { spawn } from "node:child_process";

import type { RunRequest, RunResult } from "@omnitech/interview-contracts";

export interface CodeRunner {
  run(input: RunRequest): Promise<RunResult>;
}

export interface DockerCodeRunnerOptions {
  dockerBinary?: string;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

const runtimes = {
  php: {
    image: "php:8.3-cli-alpine",
    command: ["php"],
    evalFlag: "-r",
  },
  ruby: {
    image: "ruby:3.4-alpine",
    command: ["ruby"],
    evalFlag: "-e",
  },
  typescript: {
    image: "node:22-alpine",
    command: ["node", "--experimental-strip-types"],
    evalFlag: "-e",
  },
} as const;

export class DockerCodeRunner implements CodeRunner {
  constructor(private readonly options: DockerCodeRunnerOptions = {}) {}

  run(input: RunRequest): Promise<RunResult> {
    const runtime = runtimes[input.language];
    const startedAt = performance.now();
    const maximumOutput = this.options.maxOutputBytes ?? 64_000;
    const dockerArguments = [
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
      runtime.image,
      ...runtime.command,
      runtime.evalFlag,
      input.language === "php"
        ? input.code.replace(/^\s*<\?php\s*/, "").replace(/\?>\s*$/, "")
        : input.code,
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(
        this.options.dockerBinary ?? "docker",
        dockerArguments,
        {
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const append = (current: string, chunk: Buffer) =>
        (current + chunk.toString()).slice(0, maximumOutput);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      child.on("error", reject);

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, this.options.timeoutMs ?? 5_000);

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode,
          durationMs: Math.round(performance.now() - startedAt),
          timedOut,
        });
      });

      child.stdin.end(input.stdin);
    });
  }
}
