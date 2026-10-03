import { spawn, spawnSync } from "node:child_process";
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
import {
  parseDiagnostics,
  parseJunitReport,
  parseRspecReport,
  parseVitestReport,
  type SourceMap,
  testSourceMap,
} from "./reports.js";

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

// Each framework also writes a structured report to /out for per-test results.
type ReportParser = (
  report: string,
  filename: string,
  map: SourceMap,
) => TestResult[];

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

const testRuntimes = {
  php: {
    image: "omnitech/pest-runner:latest",
    filename: "SolutionTest.php",
    dockerArguments: [
      "--tmpfs",
      "/runner/vendor/pestphp/pest-plugin-mutate/.temp:rw,noexec,nosuid,size=4m",
      "--tmpfs",
      "/runner/vendor/pestphp/pest/.temp:rw,noexec,nosuid,size=4m",
    ],
    command: [
      "/runner/vendor/bin/pest",
      "--colors=never",
      "--no-coverage",
      "--do-not-cache-result",
      "--configuration",
      "/runner/phpunit.xml",
      "--log-junit",
      "/out/report.xml",
      "/workspace/SolutionTest.php",
    ],
    report: { file: "report.xml", parse: parseJunitReport as ReportParser },
  },
  react: {
    image: "omnitech/vitest-runner:latest",
    filename: "solution.test.tsx",
    dockerArguments: [],
    command: [
      "/runner/node_modules/.bin/vitest",
      "run",
      "--environment",
      "jsdom",
      "--reporter",
      "verbose",
      "--reporter",
      "json",
      "--outputFile.json",
      "/out/report.json",
      "--includeTaskLocation",
      "/workspace/solution.test.tsx",
    ],
    report: { file: "report.json", parse: parseVitestReport as ReportParser },
  },
  ruby: {
    image: "omnitech/rspec-runner:latest",
    filename: "solution_spec.rb",
    dockerArguments: [],
    command: [
      "rspec",
      "--format",
      "documentation",
      "--format",
      "json",
      "--out",
      "/out/report.json",
      "/workspace/solution_spec.rb",
    ],
    report: { file: "report.json", parse: parseRspecReport as ReportParser },
  },
  typescript: {
    image: "omnitech/vitest-runner:latest",
    filename: "solution.test.ts",
    dockerArguments: [],
    command: [
      "/runner/node_modules/.bin/vitest",
      "run",
      "--environment",
      "node",
      "--reporter",
      "verbose",
      "--reporter",
      "json",
      "--outputFile.json",
      "/out/report.json",
      "--includeTaskLocation",
      "/workspace/solution.test.ts",
    ],
    report: { file: "report.json", parse: parseVitestReport as ReportParser },
  },
} as const;

function stripPhpTags(source: string): string {
  return source.replace(/<\?php\s*/gi, "").replace(/\?>\s*/g, "");
}

function buildPhpTestSource(solution: string, tests: string): string {
  const sections = [solution, tests]
    .map(stripPhpTags)
    .filter((section) => section.trim());

  return sections.length ? `<?php\n${sections.join("\n\n")}` : "";
}

const syntaxRuntimes = {
  php: {
    image: "php:8.3-cli-alpine",
    filename: "solution.php",
    command: ["php", "-l", "/workspace/solution.php"],
  },
  ruby: {
    image: "ruby:3.4-alpine",
    filename: "solution.rb",
    command: ["ruby", "-c", "/workspace/solution.rb"],
  },
  typescript: {
    image: "omnitech/vitest-runner:latest",
    filename: "solution.ts",
    command: [
      "node",
      "--input-type=module",
      "-e",
      "import ts from '/runner/node_modules/typescript/lib/typescript.js'; import { readFileSync } from 'node:fs'; const file = '/workspace/solution.ts'; const source = readFileSync(file, 'utf8'); const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS; const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind); const diagnostics = parsed.parseDiagnostics; if (diagnostics.length) { for (const diagnostic of diagnostics) { const at = parsed.getLineAndCharacterOfPosition(diagnostic.start ?? 0); console.error((at.line + 1) + ':' + (at.character + 1) + ': ' + ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')); } process.exitCode = 1; }",
    ],
  },
  react: {
    image: "omnitech/vitest-runner:latest",
    filename: "solution.tsx",
    command: [
      "node",
      "--input-type=module",
      "-e",
      "import ts from '/runner/node_modules/typescript/lib/typescript.js'; import { readFileSync } from 'node:fs'; const file = '/workspace/solution.tsx'; const source = readFileSync(file, 'utf8'); const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); const diagnostics = parsed.parseDiagnostics; if (diagnostics.length) { for (const diagnostic of diagnostics) { const at = parsed.getLineAndCharacterOfPosition(diagnostic.start ?? 0); console.error((at.line + 1) + ':' + (at.character + 1) + ': ' + ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')); } process.exitCode = 1; }",
    ],
  },
} as const;

function isDockerDaemonUnavailable(stderr: string): boolean {
  const normalized = stderr.toLowerCase();

  return (
    normalized.includes("cannot connect to the docker daemon") ||
    normalized.includes("failed to connect to the docker api") ||
    normalized.includes("is the docker daemon running") ||
    normalized.includes("error during connect")
  );
}

export class DockerCodeRunner implements CodeRunner {
  constructor(private readonly options: DockerCodeRunnerOptions = {}) {}

  run(input: RunRequest): Promise<RunResult> {
    const runtime = runtimes[input.language];
    const startedAt = performance.now();
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
    await writeFile(sourcePath, source, { mode: 0o600 });

    const dockerArguments = [
      "run",
      "--rm",
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
        code: [input.code, input.usageCode]
          .filter((section) => section.trim())
          .join("\n\n"),
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
        : [input.code, input.testCode]
            .filter((section) => section.trim())
            .join("\n\n");
    await writeFile(sourcePath, source, { mode: 0o600 });
    // The only writable mount: the framework's report, read back below.
    const outputDirectory = join(temporaryDirectory, "out");
    await mkdir(outputDirectory);
    await chmod(outputDirectory, 0o777);

    const dockerArguments = [
      "run",
      "--rm",
      "--interactive",
      "--network",
      "none",
      "--memory",
      "256m",
      "--cpus",
      "1",
      "--pids-limit",
      "128",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=32m",
      "--security-opt",
      "no-new-privileges",
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
      const result = tests ? { ...executed, tests } : executed;
      if (
        result.exitCode === 0 &&
        /\bNo tests found\b/i.test(`${result.stdout}\n${result.stderr}`)
      ) {
        return {
          ...result,
          stderr: [
            result.stderr.trimEnd(),
            "Test framework completed without discovering any tests.",
          ]
            .filter(Boolean)
            .join("\n"),
          exitCode: 1,
        };
      }
      return result;
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

      const cleanupTimeoutMs = 5_000;
      const timer = setTimeout(() => {
        timedOut = true;
        // Stop the container, then the client; `rm -f` covers a container the
        // kill raced with, so none outlives its run (or its mounted temp dir).
        // Bounded: a hung Docker daemon must not freeze the worker event loop
        // (and with it lease renewal) indefinitely.
        const bounded = { stdio: "ignore", timeout: cleanupTimeoutMs } as const;
        spawnSync(docker, ["kill", containerName], bounded);
        spawnSync(docker, ["rm", "-f", containerName], bounded);
        child.kill("SIGKILL");
      }, timeoutMs);

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        if (timedOut) {
          // The timer may have fired before the daemon created the container,
          // so the first kill/rm found nothing and a Created-state container
          // would remain; the client has exited now, so remove it again.
          spawnSync(docker, ["rm", "-f", containerName], {
            stdio: "ignore",
            timeout: cleanupTimeoutMs,
          });
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
