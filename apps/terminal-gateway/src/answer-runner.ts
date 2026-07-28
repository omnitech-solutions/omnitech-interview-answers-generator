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
    code: {
      type: "string",
      minLength: 1,
      maxLength: 20_000,
      description:
        "Complete solution beginning with PROBLEM, STRATEGY, and COMPLEXITY comments.",
    },
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

export function formatAnswerFailure(error: unknown): string {
  const type = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  return [
    "",
    "[ANSWER_FAILED]",
    "Stage: answer generation or publication",
    `Type: ${type}`,
    `Details: ${message}`,
    "The existing Playground answer was preserved.",
    "",
  ].join("\r\n");
}

export function normalizeSolutionHeader(
  code: string,
  language: AnswerLanguage,
): string {
  const required = [
    /(?:\/\/|#)[ \t]*PROBLEM:/i,
    /(?:\/\/|#)[ \t]*STRATEGY:/i,
    /(?:\/\/|#)[ \t]*COMPLEXITY:/i,
  ];
  if (required.every((pattern) => pattern.test(code))) return code;

  const comment = language === "ruby" ? "#" : "//";
  const remaining = code
    .split("\n")
    .filter((line) => !required.some((pattern) => pattern.test(line)))
    .join("\n")
    .trimStart();
  return [
    `${comment} PROBLEM: Implement the required interview contract.`,
    `${comment} STRATEGY: Apply the direct deterministic algorithm.`,
    `${comment} COMPLEXITY: See the complexity analysis in the answer.`,
    remaining,
  ].join("\n");
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
and COMPLEXITY comments. Add a concise [COMMENT], [GUARD], [DOMAIN],
[STRATEGY], [SAFETY], or [TRACE] comment INSIDE function/component bodies,
immediately before every major logical block: guards/normalization, state and
invariants, each algorithmic pass, consequential branches, and result assembly.
Header comments do not satisfy this body-comment requirement. Explain why the
block exists and what remains true; never narrate obvious syntax. If the
question supplies a concrete example, put a [TRACE] Input: comment INSIDE the
entry-point body containing the original method/function argument values copied
from that example. Later [TRACE] comments must keep those same names and values
consistent; never invent or silently change them. Put full expected outputs in
usageCode or tests.

usageCode must be directly executable after code and print 2-4 representative
results. testCode must use the language's real test framework:
- TypeScript/React: Vitest with \`it\`/\`test\` and \`expect\`;
- Ruby: genuine RSpec with \`RSpec.describe\`/\`describe\`, \`it\`, and
  \`expect\`; never custom assertion helpers or file-load assertions;
- PHP: genuine Pest with \`test()\`/\`it()\` and \`expect()\`; never manual
  top-level \`if\` assertions, custom assertion helpers, success printing, or
  thrown \`RuntimeException\` assertions.
Do not repeat \`<?php\` in PHP usageCode or testCode. Include 3-6 focused tests:
the supplied example, smallest valid boundary, a structurally stressful
practical case, and only applicable empty/duplicate/negative/no-solution/
repeated-call/mutation cases. Never test behavior outside the prompt's
constraints. Do not redefine the solution in usageCode or testCode.`;
}

function parseAnswer(
  value: unknown,
  options: { requireInputTrace?: boolean } = {},
): GeneratedCodingAnswer {
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
  const code = normalizeSolutionHeader(
    record["code"],
    language as AnswerLanguage,
  );
  const body =
    language === "ruby"
      ? code.match(/^\s*def\b[^\n]*\n([\s\S]*)/m)?.[1]
      : code.slice(code.indexOf("{") + 1);
  if (
    !body ||
    !/(?:\/\/|#)[^\n]*\[(?:COMMENT|GUARD|DOMAIN|STRATEGY|SAFETY|TRACE)\]/.test(
      body,
    )
  ) {
    throw new TypeError(
      "Codex omitted labeled comments inside the solution body.",
    );
  }
  if (
    options.requireInputTrace &&
    !/(?:\/\/|#)[^\n]*\[TRACE\]\s*Input:/i.test(body)
  ) {
    throw new TypeError(
      "Codex omitted the original example inputs from the entry-point body.",
    );
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
  if (
    language === "php" &&
    (!/\b(?:test|it)\s*\(/.test(record["testCode"]) ||
      !/\bexpect\s*\(/.test(record["testCode"]) ||
      /\bthrow\s+new\s+RuntimeException\b/.test(record["testCode"]) ||
      /\bfunction\s+assert[_a-z]*\s*\(/i.test(record["testCode"]) ||
      /\bAll tests passed\b/i.test(record["testCode"]))
  ) {
    throw new TypeError(
      "Codex returned PHP assertions that are not genuine Pest tests.",
    );
  }
  return {
    title: record["title"].trim(),
    language: language as AnswerLanguage,
    answerMarkdown: record["answerMarkdown"].trim(),
    code: code.trim(),
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
    let validationError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const correction =
        attempt === 1
          ? ""
          : `\n\nCORRECTION: The previous response failed validation: ${
              validationError instanceof Error
                ? validationError.message
                : String(validationError)
            }\nReturn a complete corrected JSON answer that satisfies every contract.`;
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
          input: `${buildAnswerPrompt(question, options)}${correction}`,
          maxBuffer: 1_000_000,
        },
      ) as SpawnSyncReturns<string>;

      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(
          result.stderr?.trim() || `Codex exited with status ${result.status}.`,
        );
      }
      try {
        return parseAnswer(JSON.parse(readFileSync(outputPath, "utf8")), {
          requireInputTrace: /\b(?:example|sample)\b/i.test(question),
        });
      } catch (error) {
        validationError = error;
      }
    }
    throw new Error(
      `Answer validation failed after 2 attempts: ${
        validationError instanceof Error
          ? validationError.message
          : String(validationError)
      }`,
    );
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
    process.stdout.write(formatAnswerFailure(error));
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
