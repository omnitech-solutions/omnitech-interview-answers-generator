import type {
  Diagnostic,
  EditorLocation,
  TestResult,
} from "@omnitech/interview-contracts";

// Test runs join the solution and the tests into one file. This maps a line
// in that file back to the editor the person sees.
export type SourceMap = (fileLine: number) => EditorLocation | undefined;

const lineCount = (text: string) => text.split("\n").length;
const MESSAGE_LIMIT = 2_000;

// Lines a PHP opening tag takes up at the top of a source.
const leadingTagLines = (source: string) =>
  (/^\s*<\?php\s*/i.exec(source)?.[0].split("\n").length ?? 1) - 1;

// Non-PHP: `${code}\n\n${tests}`. PHP: `<?php\n${stripped code}\n\n${stripped
// tests}`, where stripping removes each section's opening tag lines.
export function testSourceMap(input: {
  language: string;
  code: string;
  testCode: string;
  strip?: (source: string) => string;
}): SourceMap {
  const php = input.language === "php" && input.strip !== undefined;
  const solution = php ? input.strip!(input.code) : input.code;
  const tests = php ? input.strip!(input.testCode) : input.testCode;
  const solutionStart = php ? 2 : 1;
  const solutionEnd = solutionStart + lineCount(solution) - 1;
  const testsStart = solution.trim() ? solutionEnd + 2 : solutionStart;
  const solutionShift = php ? leadingTagLines(input.code) : 0;
  const testsShift = php ? leadingTagLines(input.testCode) : 0;
  return (fileLine) => {
    if (fileLine >= testsStart && tests.trim())
      return { editor: "tests", line: fileLine - testsStart + 1 + testsShift };
    if (fileLine >= solutionStart && fileLine <= solutionEnd)
      return {
        editor: "solution",
        line: fileLine - solutionStart + 1 + solutionShift,
      };
    return undefined;
  };
}

// The first place a stack or failure text mentions the test file.
function failingLine(text: string, filename: string) {
  const match = new RegExp(`${filename.replaceAll(".", "\\.")}:(\\d+)`).exec(
    text,
  );
  return match ? Number(match[1]) : undefined;
}

// The readable part of a failure: the message before the stack frames.
function failureSummary(text: string) {
  const summary = text
    .split("\n")
    .filter(
      (line) => !/^\s+at\s|^\s*#\s|^\s*\/runner\/|^at \/workspace\//.test(line),
    )
    .join("\n")
    .trim();
  return summary.slice(0, MESSAGE_LIMIT);
}

type VitestReport = {
  testResults?: {
    assertionResults?: {
      title?: string;
      ancestorTitles?: string[];
      status?: string;
      duration?: number | null;
      failureMessages?: string[];
      location?: { line?: number } | null;
    }[];
  }[];
};

export function parseVitestReport(
  json: string,
  filename: string,
  map: SourceMap,
): TestResult[] {
  const report = JSON.parse(json) as VitestReport;
  return (report.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((test): TestResult => {
      const failure = (test.failureMessages ?? []).join("\n");
      const line = failingLine(failure, filename) ?? test.location?.line;
      const location = line ? map(line) : undefined;
      return {
        name: [...(test.ancestorTitles ?? []).slice(1), test.title ?? ""]
          .filter(Boolean)
          .join(" › "),
        status:
          test.status === "passed"
            ? "passed"
            : test.status === "failed"
              ? "failed"
              : "skipped",
        ...(typeof test.duration === "number"
          ? { durationMs: Math.round(test.duration) }
          : {}),
        ...(failure ? { message: failureSummary(failure) } : {}),
        ...(location ? { location } : {}),
      };
    }),
  );
}

type RspecReport = {
  examples?: {
    description?: string;
    status?: string;
    line_number?: number;
    run_time?: number;
    exception?: { class?: string; message?: string; backtrace?: string[] };
  }[];
};

export function parseRspecReport(
  json: string,
  filename: string,
  map: SourceMap,
): TestResult[] {
  const report = JSON.parse(json) as RspecReport;
  return (report.examples ?? []).map((example): TestResult => {
    const failure = example.exception
      ? `${example.exception.class ?? "Error"}: ${example.exception.message ?? ""}`
      : "";
    const line =
      failingLine((example.exception?.backtrace ?? []).join("\n"), filename) ??
      example.line_number;
    const location = line ? map(line) : undefined;
    return {
      name: example.description ?? "",
      status:
        example.status === "passed"
          ? "passed"
          : example.status === "failed"
            ? "failed"
            : "skipped",
      ...(typeof example.run_time === "number"
        ? { durationMs: Math.round(example.run_time * 1000) }
        : {}),
      ...(failure ? { message: failureSummary(failure) } : {}),
      ...(location ? { location } : {}),
    };
  });
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const decode = (text: string) =>
  text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (entity, name: string) =>
    name.startsWith("#x")
      ? String.fromCodePoint(Number.parseInt(name.slice(2), 16))
      : name.startsWith("#")
        ? String.fromCodePoint(Number(name.slice(1)))
        : (ENTITIES[name] ?? entity),
  );
const attribute = (attributes: string, name: string) => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
  return match ? decode(match[1]!) : undefined;
};

// PHPUnit's JUnit log, as Pest writes it.
export function parseJunitReport(
  xml: string,
  filename: string,
  map: SourceMap,
): TestResult[] {
  const cases = xml.matchAll(
    /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g,
  );
  return [...cases].map(([, attributes = "", body = ""]): TestResult => {
    const failure = /<(failure|error)\b[^>]*>([\s\S]*?)<\/\1>/.exec(body);
    const name = attribute(attributes, "name") ?? "";
    // Pest starts the failure text with the test's own name.
    const raw = failure ? decode(failure[2]!) : "";
    const text = raw.startsWith(name)
      ? raw.slice(name.length).trimStart()
      : raw;
    const line =
      failingLine(text, filename) ?? Number(attribute(attributes, "line"));
    const location = line ? map(line) : undefined;
    const seconds = Number(attribute(attributes, "time"));
    return {
      name,
      status: failure
        ? "failed"
        : /<skipped\b/.test(body)
          ? "skipped"
          : "passed",
      ...(Number.isFinite(seconds)
        ? { durationMs: Math.round(seconds * 1000) }
        : {}),
      ...(text ? { message: failureSummary(text) } : {}),
      ...(location ? { location } : {}),
    };
  });
}

// Syntax checker output → problems placed in the checked editor.
// TypeScript prints "line:column: message"; PHP "... on line N"; Ruby
// "file.rb:N: message". PHP's checked file starts with its own "<?php" line.
export function parseDiagnostics(
  language: string,
  output: string,
  source: string,
): Diagnostic[] {
  const lines = output.split("\n").filter((line) => line.trim());
  if (language === "typescript" || language === "react")
    return lines.flatMap((line) => {
      const match = /^(\d+):(\d+): (.+)$/.exec(line);
      return match
        ? [
            {
              line: Number(match[1]),
              column: Number(match[2]),
              message: match[3]!,
            },
          ]
        : [];
    });
  if (language === "php")
    return lines.flatMap((line) => {
      const match =
        /^(?:PHP )?(Parse error|Fatal error): (.+?) in \S+ on line (\d+)/.exec(
          line,
        );
      if (!match) return [];
      const fileLine = Number(match[3]);
      return [
        {
          line: Math.max(1, fileLine - 1 + leadingTagLines(source)),
          message: `${match[1]}: ${match[2]}`,
        },
      ];
    });
  // Ruby puts its detail on caret lines under the summary ("| ^ expected …").
  return lines.flatMap((line, index) => {
    const match = /\.rb:(\d+): (.+)$/.exec(line);
    if (!match) return [];
    const detail = lines
      .slice(index + 1)
      .map((next) => /^\s*\|\s*\^+\s*(.+)$/.exec(next)?.[1])
      .find(Boolean);
    return [{ line: Number(match[1]), message: detail ?? match[2]! }];
  });
}
