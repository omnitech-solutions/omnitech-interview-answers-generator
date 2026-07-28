import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  RunAllRequest,
  RunRequest,
  RunResult,
  SyntaxCheckRequest,
} from "@omnitech/interview-contracts";

export interface CodeRunner {
  run(input: RunRequest): Promise<RunResult>;
  runAll(input: RunAllRequest): Promise<RunResult>;
  checkSyntax(input: SyntaxCheckRequest): Promise<RunResult>;
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
      "/workspace/SolutionTest.php",
    ],
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
      "/workspace/solution.test.tsx",
    ],
  },
  ruby: {
    image: "omnitech/rspec-runner:latest",
    filename: "solution_spec.rb",
    dockerArguments: [],
    command: [
      "rspec",
      "--format",
      "documentation",
      "/workspace/solution_spec.rb",
    ],
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
      "/workspace/solution.test.ts",
    ],
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
      "import ts from '/runner/node_modules/typescript/lib/typescript.js'; import { readFileSync } from 'node:fs'; const file = '/workspace/solution.ts'; const source = readFileSync(file, 'utf8'); const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS; const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind); const diagnostics = parsed.parseDiagnostics; if (diagnostics.length) { for (const diagnostic of diagnostics) console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\\n')); process.exitCode = 1; }",
    ],
  },
  react: {
    image: "omnitech/vitest-runner:latest",
    filename: "solution.tsx",
    command: [
      "node",
      "--input-type=module",
      "-e",
      "import ts from '/runner/node_modules/typescript/lib/typescript.js'; import { readFileSync } from 'node:fs'; const file = '/workspace/solution.tsx'; const source = readFileSync(file, 'utf8'); const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); const diagnostics = parsed.parseDiagnostics; if (diagnostics.length) { for (const diagnostic of diagnostics) console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\\n')); process.exitCode = 1; }",
    ],
  },
} as const;

function isDockerDaemonUnavailable(stderr: string): boolean {
  const normalized = stderr.toLowerCase();

  return (
    normalized.includes("cannot connect to the docker daemon") ||
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
      return await this.execute(dockerArguments, "", performance.now());
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
      runtime.image,
      ...runtime.command,
    ];

    try {
      const result = await this.execute(
        dockerArguments,
        input.stdin,
        performance.now(),
      );
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

  private execute(
    dockerArguments: string[],
    stdin: string,
    startedAt: number,
  ): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const maximumOutput = this.options.maxOutputBytes ?? 64_000;
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
