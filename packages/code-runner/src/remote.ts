import {
  type RunAllRequest,
  type RunRequest,
  type RunResult,
  runResultSchema,
  type SyntaxCheckRequest,
} from "@omnitech/interview-contracts";

import type { CodeRunner } from "./index";

export interface RemoteCodeRunnerOptions {
  baseUrl: string;
  token: string;
  // Replaced in tests; the platform fetch otherwise.
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  // A test run starts a framework and can be slow.
  timeoutMs?: number;
}

// [DOMAIN] A CodeRunner that asks the host's runner service (createRunnerHandler)
// to run the code, for a web app that cannot reach Docker itself. Every failure
// is "unavailable", which the API already turns into its 503 message.
export class RemoteCodeRunner implements CodeRunner {
  constructor(private readonly options: RemoteCodeRunnerOptions) {}

  run(input: RunRequest): Promise<RunResult> {
    return this.post("/run", input);
  }

  runAll(input: RunAllRequest): Promise<RunResult> {
    return this.post("/run-all", input);
  }

  checkSyntax(input: SyntaxCheckRequest): Promise<RunResult> {
    return this.post("/syntax-check", input);
  }

  private async post(path: string, body: unknown): Promise<RunResult> {
    const send = this.options.fetch ?? fetch;
    try {
      const response = await send(`${this.options.baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      return runResultSchema.parse(await response.json());
    } catch {
      throw new Error("The code runner is unavailable.");
    }
  }
}
