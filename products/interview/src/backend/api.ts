import { randomUUID } from "node:crypto";

import {
  explanationRequestSchema,
  generateRequestSchema,
  libraryItemInputSchema,
  librarySearchQuerySchema,
  routeQuestion,
  routeRequestSchema,
  runAllRequestSchema,
  runRequestSchema,
  saveAnswerRequestSchema,
  saveExplanationRequestSchema,
  syntaxCheckRequestSchema,
} from "@omnitech/interview-contracts";
import {
  parsePlaygroundExplanation,
  parsePlaygroundPatch,
} from "@omnitech/interview-playground-control";
import {
  LibrarySlugConflictError,
  LibraryStateError,
} from "@omnitech/interview-storage";
import { build } from "esbuild";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import { WorkspaceError, type WorkspaceScope } from "./assistant/workspace.js";
import { LibraryIndexUnavailableError } from "./library-service.js";
import { playgroundControlStore } from "./workspace-control.js";
import {
  answerRepository,
  codeRunner,
  explanationRepository,
  generateExplanation,
  generateInterviewAnswer,
  libraryRepository,
  libraryService,
} from "./services.js";
import type { StructuredGenerate } from "./structured.js";

type ApiEnvironment = {
  Variables: {
    requestId: string;
  };
};

function apiError(
  context: Context<ApiEnvironment>,
  status: 400 | 401 | 404 | 409 | 500 | 502 | 503,
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

function queryList(context: Context<ApiEnvironment>, name: string): string[] {
  return (context.req.queries(name) ?? [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseLibrarySearchQuery(context: Context<ApiEnvironment>) {
  return librarySearchQuerySchema.safeParse({
    query: context.req.query("q") ?? "",
    contentTypes: queryList(context, "type"),
    collections: queryList(context, "collection"),
    tags: queryList(context, "tag"),
    officialOnly: context.req.query("official") === "true",
    offset: Number(context.req.query("offset") ?? 0),
    limit: Number(context.req.query("limit") ?? 20),
  });
}

function libraryMutationError(
  context: Context<ApiEnvironment>,
  error: unknown,
) {
  if (error instanceof LibrarySlugConflictError) {
    return apiError(context, 409, "slug_conflict", error.message);
  }
  if (error instanceof LibraryStateError) {
    return apiError(context, 409, "invalid_library_state", error.message);
  }
  if (error instanceof LibraryIndexUnavailableError) {
    return apiError(context, 503, "library_index_unavailable", error.message);
  }
  throw error;
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

// Generation failures say what happened, for a technical reader: which
// fields of the reply broke the format, or that the model could not be
// reached. Only a WorkspaceError's hint, built from safe parts, is shown;
// anything else gets the generic message.
function generationFailure(context: Context, error: unknown, what: string) {
  if (
    error instanceof WorkspaceError &&
    error.code === "generation-failed" &&
    error.hint
  )
    return apiError(context, 502, "generation_failed", error.hint);
  return apiError(
    context,
    502,
    "generation_failed",
    `The configured AI model could not generate ${what}.`,
  );
}

export interface InterviewApiOptions {
  // The signed-in member of the tenant the request names; null refuses
  // generation.
  resolveScope: (request: Request) => Promise<WorkspaceScope | null>;
  // The host's language model. Absent when none is configured, which
  // generation reports as 503 ai_not_configured.
  generate?: StructuredGenerate;
}

export function createApi(options: InterviewApiOptions) {
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
    const content = prompt?.includes("Concept to explain:")
      ? JSON.stringify({
          title: "Interview-ready concept",
          markdown:
            "# Interview-ready concept\n\n## In one sentence\n\nExplain the core idea before the implementation detail.\n\n## Talking points\n\n- **Purpose:** connect the concept to a concrete problem.\n- **Trade-off:** state what improves and what it costs.\n\n## How it works\n\n```mermaid\nflowchart LR\n  A[Input] --> B[Decision]\n  B --> C[Outcome]\n```\n\n## Trade-offs and pitfalls\n\n- Avoid unnecessary complexity.\n\n## Interview example\n\nUse a concrete, measurable example.\n\n## Follow-up questions\n\n- What constraint changes the design?",
        })
      : JSON.stringify({
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

  app.get("/api/v1/health", (context) =>
    context.json({ ok: true, aiConfigured: options.generate !== undefined }),
  );

  // Generation runs for the member the request resolves to, on the host's
  // model; either missing stops the request before any model call.
  async function generation(context: Context<ApiEnvironment>) {
    const scope = await options.resolveScope(context.req.raw);
    if (!scope)
      return apiError(
        context,
        401,
        "unauthorized",
        "Sign in and name a tenant you belong to (x-omnitech-tenant).",
      );
    if (!options.generate)
      return apiError(
        context,
        503,
        "ai_not_configured",
        "No AI model is configured on this server.",
      );
    return { scope, generate: options.generate };
  }

  app.get("/api/v1/library/search", async (context) => {
    const parsed = parseLibrarySearchQuery(context);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The Library search query is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    try {
      return context.json(await libraryService.search(parsed.data));
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.get("/api/v1/library/facets", async (context) => {
    try {
      return context.json(await libraryService.facets());
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.get("/api/v1/library/items", async (context) => {
    try {
      await libraryService.initialize();
      const includeDrafts = context.req.query("drafts") === "true";
      return context.json(
        includeDrafts
          ? await libraryRepository.list()
          : await libraryRepository.listPublished(),
      );
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.get("/api/v1/library/items/:idOrSlug", async (context) => {
    try {
      await libraryService.initialize();
      const identifier = context.req.param("idOrSlug");
      const item =
        context.req.query("draft") === "true"
          ? await libraryRepository.get(identifier)
          : await libraryRepository.getPublished(identifier);
      return item
        ? context.json(item)
        : apiError(
            context,
            404,
            "not_found",
            "The Library item was not found.",
          );
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.post("/api/v1/library/items", async (context) => {
    const parsed = libraryItemInputSchema.safeParse(await context.req.json());
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The Library item is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    try {
      return context.json(await libraryRepository.saveDraft(parsed.data), 201);
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.put("/api/v1/library/items/:id", async (context) => {
    const parsed = libraryItemInputSchema.safeParse(await context.req.json());
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The Library item is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    try {
      return context.json(
        await libraryRepository.saveDraft(parsed.data, context.req.param("id")),
      );
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.post("/api/v1/library/items/:id/publish", async (context) => {
    try {
      const item = await libraryRepository.publish(context.req.param("id"));
      if (!item) {
        return apiError(
          context,
          404,
          "not_found",
          "The Library item was not found.",
        );
      }
      await libraryService.synchronize();
      return context.json(item);
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.post("/api/v1/library/items/:id/archive", async (context) => {
    try {
      const item = await libraryRepository.archive(context.req.param("id"));
      if (!item) {
        return apiError(
          context,
          404,
          "not_found",
          "The Library item was not found.",
        );
      }
      await libraryService.synchronize();
      return context.json(item);
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.delete("/api/v1/library/items/:id", async (context) => {
    try {
      const deleted = await libraryRepository.deleteDraft(
        context.req.param("id"),
      );
      return deleted
        ? context.json({ deleted: true })
        : apiError(
            context,
            404,
            "not_found",
            "The Library item was not found.",
          );
    } catch (error) {
      return libraryMutationError(context, error);
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
    const ready = await generation(context);
    if (ready instanceof Response) return ready;
    try {
      return context.json(
        await generateInterviewAnswer(parsed.data, ready.generate, ready.scope),
      );
    } catch (error) {
      console.error("Answer generation failed", {
        requestId: context.get("requestId"),
        error: error instanceof Error ? error.message : String(error),
      });
      return generationFailure(context, error, "an answer");
    }
  });

  app.post("/api/v1/explain", async (context) => {
    const parsed = explanationRequestSchema.safeParse(await context.req.json());
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The explanation request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    const ready = await generation(context);
    if (ready instanceof Response) return ready;
    try {
      return context.json(
        await generateExplanation(parsed.data, ready.generate, ready.scope),
      );
    } catch (error) {
      console.error("Explanation generation failed", {
        requestId: context.get("requestId"),
        error: error instanceof Error ? error.message : String(error),
      });
      return generationFailure(context, error, "an explanation");
    }
  });

  app.get("/api/v1/explanations", async (context) =>
    context.json(await explanationRepository.list()),
  );

  app.get("/api/v1/explanations/:id", async (context) => {
    const item = await explanationRepository.get(context.req.param("id"));
    return item
      ? context.json(item)
      : apiError(
          context,
          404,
          "not_found",
          "The saved explanation was not found.",
        );
  });

  app.post("/api/v1/explanations", async (context) => {
    const parsed = saveExplanationRequestSchema.safeParse(
      await context.req.json(),
    );
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The explanation is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    return context.json(await explanationRepository.save(parsed.data), 201);
  });

  app.delete("/api/v1/explanations/:id", async (context) => {
    const deleted = await explanationRepository.delete(context.req.param("id"));
    return deleted
      ? context.json({ deleted: true })
      : apiError(
          context,
          404,
          "not_found",
          "The saved explanation was not found.",
        );
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

  app.post("/api/v1/playground-control/explanations", async (context) => {
    try {
      return context.json(
        playgroundControlStore.appendExplanation(
          parsePlaygroundExplanation(await context.req.json()),
        ),
      );
    } catch (error) {
      return apiError(
        context,
        400,
        "invalid_explanation_append",
        error instanceof Error ? error.message : "The append is invalid.",
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
