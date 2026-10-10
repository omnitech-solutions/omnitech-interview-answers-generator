// What varies between languages and between kinds of run, as typed data: the
// image and command of each language's plain run, test run and syntax check,
// and the resource limits of each kind of run. No process is started here.
import type { TestResult } from "@omnitech/interview-contracts";
import {
  parseJunitReport,
  parseRspecReport,
  parseVitestReport,
  type SourceMap,
} from "./reports";

// Each framework also writes a structured report to /out for per-test results.
export type ReportParser = (
  report: string,
  filename: string,
  map: SourceMap,
) => TestResult[];

export const runtimes = {
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

export const testRuntimes = {
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

export const syntaxRuntimes = {
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

// [SAFETY] A numeric non-root uid and gid (the conventional "nobody"), so a
// breakout starts unprivileged whatever user the image defaults to. Numeric so
// it needs no passwd entry. --memory-swap equals --memory everywhere, so the
// memory limit cannot be exceeded by swapping.
export const SANDBOX_USER = "65534:65534";

export interface SandboxLimits {
  memory: string;
  cpus: string;
  pids: string;
  tmpfs: string;
}

// A plain run or a syntax check is one small process; a test run starts a
// framework (Vitest with jsdom, RSpec, Pest), so it gets twice the room.
export const SANDBOX_LIMITS = {
  run: { memory: "128m", cpus: "0.5", pids: "64", tmpfs: "16m" },
  test: { memory: "256m", cpus: "1", pids: "128", tmpfs: "32m" },
} as const satisfies Record<string, SandboxLimits>;
