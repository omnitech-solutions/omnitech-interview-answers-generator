import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface ConceptSession {
  command: string;
  name: string;
}

export function startConceptSession(
  topic: string,
  options: {
    cwd: string;
    execArgv?: string[];
    spawnSync?: typeof spawnSync;
    sessionId?: string;
  },
): ConceptSession {
  const normalizedTopic = topic.trim();
  if (!normalizedTopic) throw new TypeError("A concept topic is required.");
  if (normalizedTopic.length > 4_000) {
    throw new TypeError("The concept topic must be at most 4000 characters.");
  }

  const name = `concept-${options.sessionId ?? Date.now().toString(36)}`;
  const command = `/explain ${normalizedTopic}`;
  const runningFromTypeScript = import.meta.url.endsWith(".ts");
  const runner = fileURLToPath(
    new URL(
      runningFromTypeScript ? "./concept-runner.ts" : "./concept-runner.js",
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
      command,
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
