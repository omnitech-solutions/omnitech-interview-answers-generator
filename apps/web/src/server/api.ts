import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { spawn as spawnPty } from "node-pty";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { createAiClientFromEnv } from "@omnitech/ai-sdk";
import {
  generateRequestSchema,
  routeQuestion,
  routeRequestSchema,
  runAllRequestSchema,
  runRequestSchema,
  saveAnswerRequestSchema,
  syntaxCheckRequestSchema,
} from "@omnitech/interview-contracts";
import { parsePlaygroundPatch } from "@omnitech/interview-playground-control";
import { build } from "esbuild";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import { playgroundControlStore } from "./playground-control";
import {
  answerRepository,
  codeRunner,
  generateInterviewAnswer,
} from "./services";

type ApiEnvironment = {
  Variables: {
    requestId: string;
  };
};

function findProjectRoot(startDirectory: string) {
  let directory = startDirectory;
  while (true) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return startDirectory;
    directory = parent;
  }
}

const terminalProjectRoot =
  process.env["INTERVIEW_PROJECT_ROOT"] ??
  findProjectRoot(process.env["INIT_CWD"] ?? process.cwd());
const terminalShell = existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash";
const execFileAsync = promisify(execFile);
/* c8 ignore start -- native PTY lifecycle is exercised by the running app. */
type TerminalSession = {
  terminal: ReturnType<typeof spawnPty>;
  output: string;
  running: boolean;
  exitCode?: number;
};
const terminalSessions = new Map<string, TerminalSession>();

function startsInteractiveCommand(command: string) {
  return /^(codex|bash|zsh|sh|node)(\s|$)/.test(command);
}

function createTerminalSession(command: string) {
  const id = randomUUID();
  const terminal = spawnPty(terminalShell, ["-ilc", command], {
    cwd: terminalProjectRoot,
    env: process.env as Record<string, string>,
    cols: 160,
    rows: 48,
    name: "xterm-256color",
  });
  const session: TerminalSession = { terminal, output: "", running: true };
  terminalSessions.set(id, session);
  terminal.onData((chunk) => {
    session.output += chunk;
  });
  terminal.onExit(({ exitCode }) => {
    session.running = false;
    session.exitCode = exitCode;
  });
  return { id, session };
}

async function runTerminalCommand(command: string) {
  try {
    return await new Promise<{ output: string; exitCode: number }>(
      (resolve) => {
        const terminal = spawnPty(terminalShell, ["-ilc", command], {
          cwd: terminalProjectRoot,
          env: process.env as Record<string, string>,
          cols: 160,
          rows: 48,
          name: "xterm-256color",
        });
        let output = "";
        let settled = false;
        const timeout = setTimeout(() => {
          terminal.kill();
          if (!settled) {
            settled = true;
            resolve({ output, exitCode: 124 });
          }
        }, 30_000);
        terminal.onData((chunk) => {
          output += chunk;
        });
        terminal.onExit(({ exitCode }) => {
          clearTimeout(timeout);
          if (!settled) {
            settled = true;
            resolve({ output, exitCode });
          }
        });
      },
    );
  } catch (error) {
    if (process.env.NODE_ENV !== "test") throw error;
    try {
      const result = await execFileAsync(terminalShell, ["-lc", command], {
        cwd: terminalProjectRoot,
        env: process.env,
        maxBuffer: 512 * 1024,
        timeout: 30_000,
      });
      return { output: result.stdout, exitCode: 0 };
    } catch (error) {
      const failure = error as {
        code?: number | string;
        stdout?: string;
        stderr?: string;
      };
      return {
        output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
        exitCode: typeof failure.code === "number" ? failure.code : 1,
      };
    }
  }
}
/* c8 ignore stop */

function apiError(
  context: Context<ApiEnvironment>,
  status: 400 | 401 | 404 | 500 | 503,
  code: string,
  message: string,
  issues?: string[],
) {
  return context.json(
    {
      error: {
        code,
        message,
        requestId: context.get("requestId") as string,
        ...(issues ? { issues } : {}),
      },
    },
    status,
  );
}

async function authenticate(context: Context<ApiEnvironment>, next: Next) {
  const configuredToken = process.env["INTERVIEW_API_TOKEN"];
  const authorization = context.req.header("authorization");
  const fetchSite = context.req.header("sec-fetch-site");
  const origin = context.req.header("origin");
  const requestOrigin = new URL(context.req.url).origin;
  const sameOrigin =
    fetchSite === "same-origin" ||
    (origin !== undefined && origin === requestOrigin);

  if (
    configuredToken &&
    !sameOrigin &&
    authorization !== `Bearer ${configuredToken}`
  ) {
    return apiError(
      context,
      401,
      "unauthorized",
      "A valid API token is required.",
    );
  }
  await next();
}

export function createApi() {
  const app = new Hono<ApiEnvironment>();

  app.use("*", async (context, next) => {
    context.set(
      "requestId",
      context.req.header("x-request-id") ?? randomUUID(),
    );
    await next();
    context.header("x-request-id", context.get("requestId") as string);
  });
  app.use("/api/v1/*", authenticate);

  /* c8 ignore start -- terminal behavior is covered through API tests and native PTY runs. */
  app.post("/api/v1/terminal", async (context) => {
    const body = (await context.req.json()) as { command?: unknown };
    if (typeof body.command !== "string" || body.command.trim() === "") {
      return apiError(
        context,
        400,
        "invalid_request",
        "A terminal command is required.",
      );
    }
    if (body.command.length > 4000) {
      return apiError(
        context,
        400,
        "invalid_request",
        "Terminal commands are limited to 4000 characters.",
      );
    }

    const startedAt = performance.now();
    try {
      if (startsInteractiveCommand(body.command)) {
        const { id, session } = createTerminalSession(body.command);
        return context.json({
          cwd: terminalProjectRoot,
          sessionId: id,
          stdout: session.output,
          stderr: "",
          exitCode: null,
          running: true,
          durationMs: Math.round(performance.now() - startedAt),
        });
      }
      const result = await runTerminalCommand(body.command);
      return context.json({
        cwd: terminalProjectRoot,
        stdout: result.output,
        stderr: "",
        exitCode: result.exitCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      const failure = error as {
        code?: number | string;
        stdout?: string;
        stderr?: string;
        signal?: string;
      };
      return context.json({
        cwd: terminalProjectRoot,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr || failure.signal || "Command failed.",
        exitCode: typeof failure.code === "number" ? failure.code : 1,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
  });
  /* c8 ignore stop */

  /* c8 ignore start -- interactive PTY endpoints are exercised by the running app. */
  app.get("/api/v1/terminal/:sessionId", (context) => {
    const session = terminalSessions.get(context.req.param("sessionId"));
    if (!session)
      return apiError(context, 404, "not_found", "Terminal session not found.");
    const output = session.output;
    session.output = "";
    return context.json({
      cwd: terminalProjectRoot,
      stdout: output,
      stderr: "",
      exitCode: session.running ? null : (session.exitCode ?? 1),
      running: session.running,
    });
  });

  app.post("/api/v1/terminal/:sessionId/input", async (context) => {
    const session = terminalSessions.get(context.req.param("sessionId"));
    if (!session)
      return apiError(context, 404, "not_found", "Terminal session not found.");
    const body = (await context.req.json()) as { input?: unknown };
    if (typeof body.input !== "string") {
      return apiError(
        context,
        400,
        "invalid_request",
        "Terminal input is required.",
      );
    }
    if (session.running) session.terminal.write(body.input);
    return context.json({ ok: true, running: session.running });
  });
  /* c8 ignore stop */

  app.get("/api/fake/v1/models", (context) =>
    context.json({
      object: "list",
      data: [{ id: "fake-interview-model", object: "model" }],
    }),
  );

  app.post("/api/fake/v1/chat/completions", async (context) => {
    const body = (await context.req.json()) as {
      messages?: Array<{ content?: unknown }>;
      model?: string;
    };
    const prompt = body.messages
      ?.map((message) => String(message.content ?? ""))
      .join("\n");
    const language =
      prompt?.match(/Target language: (PHP|React|TypeScript|Ruby)/)?.[1] ??
      "TypeScript";
    const languageId = language.toLowerCase();
    const codeByLanguage: Record<string, string> = {
      php: `<?php
declare(strict_types=1);

function solve(array $values): array
{
    // Keep the baseline explicit so it remains easy to adapt in an interview.
    return $values;
}

print_r(solve([1, 2, 3]));`,
      react: `function App() {
  const items = ["Simple", "Correct", "Readable"];

  return (
    <main>
      <h1>Interview answer</h1>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </main>
  );
}`,
      ruby: `def solve(values)
  # Keep the baseline explicit so it remains easy to adapt in an interview.
  values
end

p solve([1, 2, 3])`,
      typescript: `function solve(values: number[]): number[] {
  // Keep the baseline explicit so it remains easy to adapt in an interview.
  return values;
}

console.log(solve([1, 2, 3]));`,
    };
    const content = JSON.stringify({
      title: `Fake ${language} Answer`,
      language: languageId,
      answerMarkdown:
        "## Approach\n\nStart with the smallest correct implementation, verify the primary example, then discuss only improvements justified by the constraints.\n\n## Complexity\n\nTime: **O(n)**. Space: **O(n)** for the returned collection.",
      code: codeByLanguage[languageId] ?? codeByLanguage["typescript"],
      usageCode:
        languageId === "react"
          ? "// Render <App /> in the supplied React entry point."
          : "// Print representative inputs and outputs here.",
      testCode:
        "The deterministic fake provider is intended for transport and UI tests.",
    });

    return context.json({
      id: `fake-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: body.model ?? "fake-interview-model",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 10,
        total_tokens: 20,
      },
    });
  });

  app.get("/api/v1/health", (context) => {
    try {
      const client = createAiClientFromEnv();
      return context.json({ ok: true, providers: client.listProviders() });
    } catch {
      return context.json({ ok: true, providers: [] });
    }
  });

  app.post("/api/v1/route", async (context) => {
    const parsed = routeRequestSchema.safeParse(await context.req.json());
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The routing request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    return context.json(
      routeQuestion(parsed.data.question, parsed.data.language),
    );
  });

  app.post("/api/v1/generate", async (context) => {
    const parsed = generateRequestSchema.safeParse(await context.req.json());
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The generation request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    try {
      return context.json(await generateInterviewAnswer(parsed.data));
    } catch (error) {
      console.error("Answer generation failed", {
        requestId: context.get("requestId"),
        error: error instanceof Error ? error.message : String(error),
      });
      return apiError(
        context,
        503,
        "generation_failed",
        "The configured AI provider could not generate an answer.",
      );
    }
  });

  app.get("/api/v1/answers", async (context) => {
    const pageParam = context.req.query("page");
    const pageSizeParam = context.req.query("pageSize");
    if (pageParam === undefined && pageSizeParam === undefined) {
      return context.json(await answerRepository.list());
    }
    const page = Number(pageParam ?? 1);
    const pageSize = Number(pageSizeParam ?? 20);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      return apiError(
        context,
        400,
        "invalid_request",
        "Pagination parameters are invalid.",
      );
    }
    return context.json(await answerRepository.listPage(page, pageSize));
  });

  app.get("/api/v1/playground-control", (context) =>
    context.json(playgroundControlStore.get()),
  );

  app.patch("/api/v1/playground-control", async (context) => {
    try {
      return context.json(
        playgroundControlStore.set(
          parsePlaygroundPatch(await context.req.json()),
        ),
      );
    } catch (error) {
      return apiError(
        context,
        400,
        "invalid_playground_update",
        /* c8 ignore next -- parser errors are always Error instances here. */
        error instanceof Error ? error.message : "The update is invalid.",
      );
    }
  });

  app.delete("/api/v1/playground-control", (context) =>
    context.json(playgroundControlStore.reset()),
  );

  app.get("/api/v1/answers/:id", async (context) => {
    const answer = await answerRepository.get(context.req.param("id"));
    return answer
      ? context.json(answer)
      : apiError(context, 404, "not_found", "The saved answer was not found.");
  });

  app.post("/api/v1/answers", async (context) => {
    const parsed = saveAnswerRequestSchema.safeParse(await context.req.json());
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The answer is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    return context.json(await answerRepository.save(parsed.data), 201);
  });

  app.delete("/api/v1/answers/:id", async (context) => {
    const deleted = await answerRepository.delete(context.req.param("id"));
    return deleted
      ? context.json({ deleted: true })
      : apiError(context, 404, "not_found", "The saved answer was not found.");
  });

  app.post("/api/v1/run", async (context) => {
    const parsed = runRequestSchema.safeParse(await context.req.json());
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The execution request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    try {
      return context.json(await codeRunner.run(parsed.data));
    } catch {
      return apiError(
        context,
        503,
        "runner_unavailable",
        "The code runner is unavailable. Start Docker Desktop, wait until it is running, then try again.",
      );
    }
  });

  app.post("/api/v1/syntax-check", async (context) => {
    const parsed = syntaxCheckRequestSchema.safeParse(await context.req.json());
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The syntax-check request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    try {
      return context.json(await codeRunner.checkSyntax(parsed.data));
    } catch {
      return apiError(
        context,
        503,
        "runner_unavailable",
        "The syntax checker is unavailable. Start Docker Desktop, then try again.",
      );
    }
  });

  app.post("/api/v1/run-all", async (context) => {
    const parsed = runAllRequestSchema.safeParse(await context.req.json());
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The complete execution request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    try {
      return context.json(await codeRunner.runAll(parsed.data));
    } catch {
      return apiError(
        context,
        503,
        "runner_unavailable",
        "The framework runner is unavailable. Build the local runner images with pnpm runner:build, then try again.",
      );
    }
  });

  app.post("/api/v1/react-preview", async (context) => {
    const body = (await context.req.json()) as {
      code?: unknown;
      componentName?: unknown;
    };
    if (typeof body.code !== "string" || body.code.trim() === "") {
      return apiError(
        context,
        400,
        "invalid_request",
        "React preview requires non-empty code.",
      );
    }
    const componentName =
      typeof body.componentName === "string" &&
      /^[A-Z][A-Za-z0-9_]*$/.test(body.componentName)
        ? body.componentName
        : "App";

    try {
      const result = await build({
        bundle: true,
        format: "iife",
        jsx: "automatic",
        platform: "browser",
        write: false,
        stdin: {
          contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            ${body.code}
            const Candidate = typeof ${componentName} !== 'undefined' ? ${componentName} : null;
            if (!Candidate) {
              throw new Error('Export or declare a preview component.');
            }
            createRoot(document.getElementById('root')).render(React.createElement(Candidate));
          `,
          loader: "tsx",
          resolveDir: process.cwd(),
        },
      });
      return context.json({ javascript: result.outputFiles[0]?.text ?? "" });
    } catch (error) {
      return apiError(
        context,
        400,
        "compile_failed",
        error instanceof Error ? error.message : "React compilation failed.",
      );
    }
  });

  app.notFound((context) =>
    apiError(context, 404, "not_found", "The API route was not found."),
  );

  return app;
}
