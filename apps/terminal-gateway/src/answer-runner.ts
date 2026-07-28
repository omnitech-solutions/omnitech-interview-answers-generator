import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const languages = ["php", "react", "typescript", "ruby"] as const;
type AnswerLanguage = (typeof languages)[number];

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "language",
    "answerMarkdown",
    "code",
    "usageCode",
    "testCode",
    "notes",
  ],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 100 },
    language: { type: "string", enum: languages },
    answerMarkdown: { type: "string", minLength: 1, maxLength: 8_000 },
    code: { type: "string", minLength: 1, maxLength: 20_000 },
    usageCode: { type: "string", minLength: 1, maxLength: 8_000 },
    testCode: { type: "string", minLength: 1, maxLength: 16_000 },
    notes: { type: "string", maxLength: 1_000 },
  },
} as const;

export interface GeneratedCodingAnswer {
  answerMarkdown: string;
  code: string;
  language: AnswerLanguage;
  notes: string;
  testCode: string;
  title: string;
  usageCode: string;
}

export function buildAnswerPrompt(
  question: string,
  options: {
    currentAnswer?: GeneratedCodingAnswer;
    refinement?: string;
  } = {},
): string {
  const refinementContext =
    options.refinement && options.currentAnswer
      ? `
Revise the current answer according to this request:
${options.refinement}

Current answer JSON:
${JSON.stringify(options.currentAnswer)}

Return a complete replacement answer. Preserve correct existing behavior unless
the request changes it. Fix any related explanation, solution, usage, and tests
together; do not return a patch or discuss the changes.
`
      : "";
  return `Solve this coding interview question:
${question}
${refinementContext}

Return only the requested JSON object. Do not inspect files, run commands, use
tools, explain your process, or update any application.

Choose React only for a component/hook/JSX question, PHP or Ruby when explicit,
and TypeScript for ambiguous algorithms. Preserve every required name,
signature, return contract, constraint, and observable behavior.

Produce the simplest correct, browser-interview-safe solution:
- standard language/runtime APIs only; no filesystem, network, timers, process
  termination, environment variables, or external solution dependencies;
- make every allowed boundary path deterministic without inventing validation;
- prevent out-of-bounds access and non-terminating loops; preserve duplicates,
  ordering, mutation semantics, and numeric behavior when relevant;
- put the exact entry point before helpers.

answerMarkdown must contain concise point-form sections in this exact order:
## Question, ## Approach, ## Complexity, ## Edge cases, ## Talking points.
Bold only useful interview keywords, invariants, trade-offs, and complexity.

code must be complete and start with language-appropriate PROBLEM, STRATEGY,
and COMPLEXITY comments. Add [GUARD], [DOMAIN], [STRATEGY], or [SAFETY]
comments only for non-trivial decisions; never narrate obvious syntax or put
example inputs/outputs in comments.

usageCode must be directly executable after code and print 2-4 representative
results. testCode must be directly executable after code and usageCode. Use
Vitest for TypeScript/React and genuine RSpec for Ruby with
\`RSpec.describe\`/\`describe\`, \`it\`, and \`expect\`; never create a custom
assertion helper or execute Ruby assertions at file load time. Use explicit
RuntimeException assertions for PHP. Include 3-6 focused tests: the supplied
example, smallest valid boundary, a structurally stressful practical case, and
only applicable empty/duplicate/negative/no-solution/repeated-call/mutation
cases. Never test behavior outside the prompt's constraints. Do not redefine
the solution in usageCode or testCode.`;
}

function parseAnswer(value: unknown): GeneratedCodingAnswer {
  if (!value || typeof value !== "object") {
    throw new TypeError("Codex returned an invalid coding answer.");
  }
  const record = value as Record<string, unknown>;
  const language = record["language"];
  if (
    typeof record["title"] !== "string" ||
    typeof language !== "string" ||
    !languages.includes(language as AnswerLanguage) ||
    typeof record["answerMarkdown"] !== "string" ||
    typeof record["code"] !== "string" ||
    typeof record["usageCode"] !== "string" ||
    typeof record["testCode"] !== "string" ||
    typeof record["notes"] !== "string" ||
    !record["title"].trim() ||
    !record["answerMarkdown"].trim() ||
    !record["code"].trim() ||
    !record["usageCode"].trim() ||
    !record["testCode"].trim()
  ) {
    throw new TypeError("Codex returned an incomplete coding answer.");
  }
  if (
    !/(?:\/\/|#)[ \t]*PROBLEM:/i.test(record["code"]) ||
    !/(?:\/\/|#)[ \t]*STRATEGY:/i.test(record["code"]) ||
    !/(?:\/\/|#)[ \t]*COMPLEXITY:/i.test(record["code"])
  ) {
    throw new TypeError("Codex omitted the required solution comment header.");
  }
  if (
    language === "ruby" &&
    (!/\b(?:RSpec\.)?describe\b/.test(record["testCode"]) ||
      !/\bit\s*(?:\(|["'])/.test(record["testCode"]) ||
      !/\bexpect\s*\(/.test(record["testCode"]) ||
      /\bdef\s+assert[_a-z]*/.test(record["testCode"]))
  ) {
    throw new TypeError(
      "Codex returned Ruby tests that are not genuine RSpec examples.",
    );
  }
  return {
    title: record["title"].trim(),
    language: language as AnswerLanguage,
    answerMarkdown: record["answerMarkdown"].trim(),
    code: record["code"].trim(),
    usageCode: record["usageCode"].trim(),
    testCode: record["testCode"].trim(),
    notes: record["notes"].trim(),
  };
}

export function runCodexAnswer(
  question: string,
  options: {
    currentAnswer?: GeneratedCodingAnswer;
    refinement?: string;
    spawnSync?: typeof spawnSync;
  } = {},
): GeneratedCodingAnswer {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "answer-codex-"));
  const schemaPath = join(temporaryDirectory, "schema.json");
  const outputPath = join(temporaryDirectory, "answer.json");
  writeFileSync(schemaPath, JSON.stringify(outputSchema));

  try {
    const result = (options.spawnSync ?? spawnSync)(
      "codex",
      [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-rules",
        "-C",
        temporaryDirectory,
        "-c",
        'model_reasoning_effort="low"',
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "-",
      ],
      {
        cwd: temporaryDirectory,
        encoding: "utf8",
        input: buildAnswerPrompt(question, options),
        maxBuffer: 1_000_000,
      },
    ) as SpawnSyncReturns<string>;

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        result.stderr?.trim() || `Codex exited with status ${result.status}.`,
      );
    }
    return parseAnswer(JSON.parse(readFileSync(outputPath, "utf8")));
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function publishAnswer(
  question: string,
  answer: GeneratedCodingAnswer,
  options: { fetch?: typeof globalThis.fetch; url?: string } = {},
): Promise<void> {
  const response = await (options.fetch ?? globalThis.fetch)(
    options.url ??
      process.env["INTERVIEW_PLAYGROUND_CONTROL_URL"] ??
      "http://127.0.0.1:3000/api/v1/playground-control",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        view: "playground",
        question,
        language: answer.language,
        answer: {
          title: answer.title,
          language: answer.language,
          answerMarkdown: answer.answerMarkdown,
          code: answer.code,
          usageCode: answer.usageCode,
          testCode: answer.testCode,
        },
        notes: answer.notes,
        panel: "output",
      }),
      signal: AbortSignal.timeout(1_500),
    },
  );
  if (!response.ok) {
    throw new Error(`Playground update failed with HTTP ${response.status}.`);
  }
}

async function main() {
  const question = process.argv[2]?.trim();
  if (!question) process.exit(2);
  const refinement = process.argv[3]?.trim() || undefined;
  const currentAnswer = process.argv[4]
    ? parseAnswer(JSON.parse(process.argv[4]))
    : undefined;

  const startedAt = performance.now();
  process.stdout.write(
    `\r\n› ${
      refinement ? `/answer refine ${refinement}` : `/answer ${question}`
    }\r\n\r\nGenerating a validated answer with Codex…\r\n`,
  );
  try {
    const answer = runCodexAnswer(question, {
      ...(currentAnswer === undefined ? {} : { currentAnswer }),
      ...(refinement === undefined ? {} : { refinement }),
    });
    await publishAnswer(question, answer);
    const elapsedSeconds = ((performance.now() - startedAt) / 1_000).toFixed(1);
    process.stdout.write(
      `Published “${answer.title}” with usage and tests in ${elapsedSeconds}s.\r\n`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }

  const shell = process.env["SHELL"] || "/bin/zsh";
  process.stdout.write(
    "\r\nCodex session finished. The terminal remains available.\r\n\r\n",
  );
  spawnSync(shell, ["-i"], { stdio: "inherit" });
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  void main();
}
