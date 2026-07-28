import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "markdown"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 100 },
    markdown: { type: "string", minLength: 1, maxLength: 8_000 },
  },
} as const;

export interface GeneratedConcept {
  markdown: string;
  title: string;
}

export function formatConceptFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `\r\n[CONCEPT_FAILED] ${message}\r\n`;
}

export function normalizeCommentedExample(markdown: string): string {
  const fencedCode = /```([a-z][\w+-]*)\n([\s\S]+?)\n```/i;
  const match = fencedCode.exec(markdown);
  if (!match) {
    throw new TypeError(
      "Codex returned a concept answer without the required code example.",
    );
  }

  const language = (match[1] ?? "").toLowerCase();
  const source = match[2] ?? "";
  const comment = language === "ruby" ? "#" : "//";
  const requiredHeaders = [
    {
      pattern: /(?:\/\/|#)[ \t]*PROBLEM:/i,
      value: `${comment} PROBLEM: Ground the interview question in code.`,
    },
    {
      pattern: /(?:\/\/|#)[ \t]*STRATEGY:/i,
      value: `${comment} STRATEGY: Isolate the mechanism being discussed.`,
    },
    {
      pattern: /(?:\/\/|#)[ \t]*COMPLEXITY:/i,
      value: `${comment} COMPLEXITY: Use the bounds stated in the answer.`,
    },
  ];
  const sourceLines = source.split("\n");
  const headers = requiredHeaders.map(
    ({ pattern, value }) =>
      sourceLines.find((line) => pattern.test(line))?.trim() ?? value,
  );
  const remaining = sourceLines.filter(
    (line) => !requiredHeaders.some(({ pattern }) => pattern.test(line)),
  );
  if (
    !/(?:\/\/|#|<!--)[^\n]*\[(?:COMMENT|GUARD|DOMAIN|STRATEGY|SAFETY)\]/.test(
      remaining.join("\n"),
    )
  ) {
    remaining.unshift(
      `${comment} [DOMAIN] Keep the example focused on the interview decision.`,
    );
  }

  const normalizedBlock = `\`\`\`${match[1]}\n${[...headers, ...remaining].join("\n")}\n\`\`\``;
  return `${markdown.slice(0, match.index)}${normalizedBlock}${markdown.slice(
    match.index + match[0].length,
  )}`;
}

export function buildConceptPrompt(topic: string): string {
  return `Answer this technical interview question directly:
${topic}

Return only the requested JSON object. Do not inspect files, run commands, use
tools, explain your process, or update any application.

The markdown must use exactly:
# Short title
## Questions
### Question #1: Concise question
- **Answer:** direct answer
- **Mechanics:** minimum mechanism
- **Distinction:** important misconception or trade-off
#### Example
Exactly one valid 7-14 line fenced code block. Use the requested language,
React/TypeScript for frontend concepts, and TypeScript otherwise. Start it
exactly with "// PROBLEM:", "// STRATEGY:", and "// COMPLEXITY:" (use "#"
for Ruby). Use N/A only when
complexity genuinely does not apply. Label non-trivial decisions with
[COMMENT], [GUARD], [DOMAIN], [STRATEGY], or [SAFETY]. Never narrate trivial
assignments, loop increments, setters, or JSX. Never put example inputs,
outputs, or I/O traces in comments. Keep a required entry point above helpers.
#### Talking points
Exactly three short bullets.

Keep the three answer bullets under 70 spoken words total. Use inline code for
API names and identifiers. Never invent extra questions.`;
}

export function runCodexConcept(
  topic: string,
  options: {
    spawnSync?: typeof spawnSync;
  } = {},
): GeneratedConcept {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "concept-codex-"));
  const schemaPath = join(temporaryDirectory, "schema.json");
  const outputPath = join(temporaryDirectory, "answer.json");
  writeFileSync(schemaPath, JSON.stringify(outputSchema));

  try {
    const prompts = [
      buildConceptPrompt(topic),
      `${buildConceptPrompt(topic)}

CRITICAL CORRECTION: The previous response omitted the required fenced code
example. Include it now with all four required comment lines. Do not omit the
Example section.`,
    ];
    let lastError: unknown;
    for (const prompt of prompts) {
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
          input: prompt,
          maxBuffer: 1_000_000,
        },
      ) as SpawnSyncReturns<string>;

      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(
          result.stderr?.trim() || `Codex exited with status ${result.status}.`,
        );
      }

      const parsed = JSON.parse(readFileSync(outputPath, "utf8")) as {
        markdown?: unknown;
        title?: unknown;
      };
      if (
        typeof parsed.title !== "string" ||
        !parsed.title.trim() ||
        typeof parsed.markdown !== "string" ||
        !parsed.markdown.trim()
      ) {
        throw new TypeError("Codex returned an invalid concept answer.");
      }
      try {
        return {
          title: parsed.title.trim(),
          markdown: normalizeCommentedExample(parsed.markdown.trim()),
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function appendConcept(
  topic: string,
  concept: GeneratedConcept,
  options: {
    fetch?: typeof globalThis.fetch;
    url?: string;
  } = {},
): Promise<void> {
  const response = await (options.fetch ?? globalThis.fetch)(
    options.url ??
      process.env["INTERVIEW_PLAYGROUND_APPEND_URL"] ??
      "http://127.0.0.1:3000/api/v1/playground-control/explanations",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...concept, topic }),
      signal: AbortSignal.timeout(1_500),
    },
  );
  if (!response.ok) {
    throw new Error(`Concept Lab append failed with HTTP ${response.status}.`);
  }
}

async function main() {
  const topic = process.argv[2]?.trim();
  if (!topic) process.exit(2);

  const startedAt = performance.now();
  process.stdout.write(
    `\r\n› /explain ${topic}\r\n\r\nGenerating with Codex…\r\n`,
  );
  try {
    const concept = runCodexConcept(topic);
    await appendConcept(topic, concept);
    const elapsedSeconds = ((performance.now() - startedAt) / 1_000).toFixed(1);
    process.stdout.write(
      `Added “${concept.title}” to Concept Lab in ${elapsedSeconds}s.\r\n`,
    );
  } catch (error) {
    process.stdout.write(formatConceptFailure(error));
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
