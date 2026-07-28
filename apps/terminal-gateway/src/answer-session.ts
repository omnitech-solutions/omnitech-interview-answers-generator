import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface AnswerSession {
  command: string;
  name: string;
}

export interface ExistingAnswer {
  answerMarkdown: string;
  code: string;
  language: string;
  notes?: string;
  testCode: string;
  title: string;
  usageCode: string;
}

export function startAnswerSession(
  question: string,
  options: {
    currentAnswer?: ExistingAnswer;
    cwd: string;
    execArgv?: string[];
    refinement?: string;
    spawnSync?: typeof spawnSync;
    sessionId?: string;
  },
): AnswerSession {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) {
    throw new TypeError("An interview question is required.");
  }
  if (normalizedQuestion.length > 8_000) {
    throw new TypeError(
      "The interview question must be at most 8000 characters.",
    );
  }
  const refinement = options.refinement?.trim() ?? "";
  if (refinement.length > 4_000) {
    throw new TypeError(
      "The refinement request must be at most 4000 characters.",
    );
  }
  if (refinement && !options.currentAnswer) {
    throw new TypeError("A current answer is required for refinement.");
  }

  const name = `answer-${options.sessionId ?? Date.now().toString(36)}`;
  const command = refinement
    ? `/answer refine ${refinement}`
    : `/answer ${normalizedQuestion}`;
  const runningFromTypeScript = import.meta.url.endsWith(".ts");
  const runner = fileURLToPath(
    new URL(
      runningFromTypeScript ? "./answer-runner.ts" : "./answer-runner.js",
      import.meta.url,
    ),
  );
  const result = (options.spawnSync ?? spawnSync)(
    "tmux",
    [
      "new-session",
      "-d",
      "-s",
      name,
      process.execPath,
      ...(runningFromTypeScript ? (options.execArgv ?? process.execArgv) : []),
      runner,
      normalizedQuestion,
      refinement,
      options.currentAnswer ? JSON.stringify(options.currentAnswer) : "",
    ],
    {
      cwd: options.cwd,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || `tmux exited with status ${result.status}.`,
    );
  }
  return { command, name };
}
