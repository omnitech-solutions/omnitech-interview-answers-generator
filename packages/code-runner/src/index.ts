import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  RunAllRequest,
  RunRequest,
  RunResult,
  SyntaxCheckRequest,
  TestResult,
} from "@omnitech/interview-contracts";
import { parseDiagnostics, type SourceMap, testSourceMap } from "./reports";
import {
  buildPhpTestSource,
  failWhenNoTestsFound,
  isDockerDaemonUnavailable,
  joinSections,
  sandboxArguments,
  stripPhpTags,
} from "./run-rules";
import {
  type ReportParser,
  runtimes,
  SANDBOX_LIMITS,
  syntaxRuntimes,
  testRuntimes,
} from "./runtimes";

export interface CodeRunner {
  run(input: RunRequest): Promise<RunResult>;
  runAll(input: RunAllRequest): Promise<RunResult>;
  checkSyntax(input: SyntaxCheckRequest): Promise<RunResult>;
}

export interface DockerCodeRunnerOptions {
  dockerBinary?: string;
  maxOutputBytes?: number;
  timeoutMs?: number;
  // Test runs start a framework (Vitest with jsdom, RSpec, Pest), so they get
  // a longer budget than a plain run.
  testTimeoutMs?: number;
}

// The sandboxed runner: it writes the source to a private temporary directory,
// starts one locked-down container and reads back what it printed and
// reported. Which image and command a language uses is data in ./runtimes;
// what source it is given and how its output is judged is in ./run-rules.
export class DockerCodeRunner implements CodeRunner {
  constructor(private readonly options: DockerCodeRunnerOptions = {}) {}

  run(input: RunRequest): Promise<RunResult> {
    const runtime = runtimes[input.language];
    const startedAt = performance.now();
    const dockerArguments = [
      "run",
      "--rm",
      "--interactive",
      ...sandboxArguments(SANDBOX_LIMITS.run),
      runtime.image,
      ...runtime.command,
      runtime.evalFlag,
      input.language === "php" ? stripPhpTags(input.code) : input.code,
    ];

    return this.execute(dockerArguments, input.stdin, startedAt);
  }

  async checkSyntax(input: SyntaxCheckRequest): Promise<RunResult> {
    const runtime = syntaxRuntimes[input.language];
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "interview-answer-syntax-"),
    );
    const sourcePath = join(temporaryDirectory, runtime.filename);
    const source =
      input.language === "php"
        ? buildPhpTestSource(input.code, "")
        : input.code;
    // Readable by the sandbox user; the temporary directory itself is 0700, so
    // no other host user can reach it.
    await writeFile(sourcePath, source, { mode: 0o644 });

    const dockerArguments = [
      "run",
      "--rm",
      ...sandboxArguments(SANDBOX_LIMITS.run),
      "--volume",
      `${sourcePath}:/workspace/${runtime.filename}:ro`,
      runtime.image,
      ...runtime.command,
    ];

    try {
      const result = await this.execute(dockerArguments, "", performance.now());
      const diagnostics = parseDiagnostics(
        input.language,
        `${result.stderr}\n${result.stdout}`,
        input.code,
      );
      return diagnostics.length ? { ...result, diagnostics } : result;
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async runAll(input: RunAllRequest): Promise<RunResult> {
    // A Run All request always executes the answer. Tests are an optional
    // second phase; when the Tests tab is empty, skip the test runner.
    if (!input.testCode.trim() && input.language !== "react") {
      return this.run({
        language: input.language,
        code: joinSections(input.code, input.usageCode),
        stdin: input.stdin,
      });
    }
    const runtime = testRuntimes[input.language];
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "interview-answer-run-"),
    );
    const sourcePath = join(temporaryDirectory, runtime.filename);
    // Test runs must stay focused on assertions. Usage output belongs only in
    // the normal-output phase and must never pollute the Test results tab.
    const source =
      input.language === "php"
        ? buildPhpTestSource(input.code, input.testCode)
        : joinSections(input.code, input.testCode);
    // Readable by the sandbox user; the temporary directory itself is 0700, so
    // no other host user can reach it.
    await writeFile(sourcePath, source, { mode: 0o644 });
    // The only writable mount: the framework's report, read back below.
    const outputDirectory = join(temporaryDirectory, "out");
    await mkdir(outputDirectory);
    // The container runs as SANDBOX_USER, not the owner of this directory, so
    // it needs write and search access as "other" to create the report. It
    // gets no read access (-wx): it cannot list or read what is there, and the
    // host (the owner) reads and removes the report. Narrower than 0777.
    await chmod(outputDirectory, 0o703);

    const dockerArguments = [
      "run",
      "--rm",
      "--interactive",
      ...sandboxArguments(SANDBOX_LIMITS.test),
      "--env",
      "NO_COLOR=1",
      ...runtime.dockerArguments,
      "--volume",
      `${sourcePath}:/workspace/${runtime.filename}:ro`,
      "--volume",
      `${outputDirectory}:/out:rw`,
      runtime.image,
      ...runtime.command,
    ];

    try {
      const executed = await this.execute(
        dockerArguments,
        input.stdin,
        performance.now(),
        this.options.testTimeoutMs ?? 20_000,
      );
      const tests = await this.readReport(
        join(outputDirectory, runtime.report.file),
        runtime.report.parse,
        runtime.filename,
        testSourceMap({ ...input, strip: stripPhpTags }),
      );
      return failWhenNoTestsFound(tests ? { ...executed, tests } : executed);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  // A missing or unreadable report (timeout, compile error) leaves the run
  // without per-test results; its output still explains what happened.
  private async readReport(
    path: string,
    parse: ReportParser,
    filename: string,
    map: SourceMap,
  ): Promise<TestResult[] | undefined> {
    try {
      const tests = parse(await readFile(path, "utf8"), filename, map);
      return tests.length ? tests : undefined;
    } catch {
      return undefined;
    }
  }

  private execute(
    dockerArguments: string[],
    stdin: string,
    startedAt: number,
    timeoutMs = this.options.timeoutMs ?? 5_000,
  ): Promise<RunResult> {
    // Every container gets a unique name so a timeout can kill the container
    // itself: killing only the docker CLI client leaves it running. Images are
    // never pulled at run time and every Linux capability is dropped.
    const containerName = `interview-run-${randomUUID()}`;
    const [subcommand, ...rest] = dockerArguments;
    const namedArguments = [
      subcommand as string,
      "--name",
      containerName,
      "--pull=never",
      "--cap-drop",
      "ALL",
      ...rest,
    ];
    const docker = this.options.dockerBinary ?? "docker";
    const cleanupTimeoutMs = 5_000;
    return new Promise((resolve, reject) => {
      const maximumOutput = this.options.maxOutputBytes ?? 64_000;
      const child = spawn(docker, namedArguments, {
        stdio: ["pipe", "pipe", "pipe"],
      });
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

      // Cleanup is asynchronous and bounded: a hung Docker daemon must never
      // block the event loop (and with it the worker's lease renewal), nor
      // hold the run's result hostage. Failures are swallowed; the run result
      // already reports the timeout.
      const cleanup = (cleanupArguments: string[]) => {
        execFile(
          docker,
          cleanupArguments,
          { timeout: cleanupTimeoutMs, killSignal: "SIGKILL" },
          () => undefined,
        );
      };
      const timer = setTimeout(() => {
        timedOut = true;
        // Stop the container, then the client; `rm -f` covers a container the
        // kill raced with, so none outlives its run (or its mounted temp dir).
        cleanup(["kill", containerName]);
        cleanup(["rm", "-f", containerName]);
        child.kill("SIGKILL");
      }, timeoutMs);

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        if (timedOut) {
          // The timer may have fired before the daemon created the container,
          // so the first kill/rm found nothing and a Created-state container
          // would remain; the client has exited now, so remove it again.
          cleanup(["rm", "-f", containerName]);
        }
        if (isDockerDaemonUnavailable(stderr)) {
          reject(new Error("Docker daemon is unavailable."));
          return;
        }
        resolve({
          stdout,
          stderr,
          exitCode,
          durationMs: Math.round(performance.now() - startedAt),
          timedOut,
        });
      });

      child.stdin.end(stdin);
    });
  }
}

export { RemoteCodeRunner, type RemoteCodeRunnerOptions } from "./remote";
export { createRunnerHandler } from "./serve";
