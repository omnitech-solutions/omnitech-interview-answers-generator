import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import {
  answerGuideSchema,
  coachActivityInputSchema,
  coachNoteInputSchema,
  coachTranscriptInputSchema,
  explanationRequestSchema,
  generateRequestSchema,
  libraryItemInputSchema,
  librarySearchQuerySchema,
  renderGuideMarkdown,
  routeQuestion,
  routeRequestSchema,
  runAllRequestSchema,
  runRequestSchema,
  saveAnswerRequestSchema,
  saveExplanationRequestSchema,
  syntaxCheckRequestSchema,
} from "@omnitech/interview-contracts";
import {
  type PlaygroundPatch,
  parsePlaygroundExplanation,
  parsePlaygroundPatch,
} from "@omnitech/interview-playground-control";
import {
  LibrarySlugConflictError,
  LibraryStateError,
} from "@omnitech/interview-storage";
import { readBoundedJson } from "@omnitech/platform-contracts";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import { WorkspaceError, type WorkspaceScope } from "./assistant/workspace";
import { coachNotes, replayCoachNotes } from "./coach-notes";
import { COACH_PLAN_LENGTH, coachPlan } from "./coach-plan";
import { coachTranscript } from "./coach-transcript";
import {
  CONVERSATION_HEADER,
  coachWriters,
  parseWriter,
  WRITER_HEADER,
} from "./coach-writer";
import { LibraryIndexUnavailableError } from "./library-service";
import {
  bundleReactPreview,
  PreviewCompileError,
  PreviewImportRefusedError,
} from "./react-preview";
import {
  answerRepository,
  codeRunner,
  explanationRepository,
  generateExplanation,
  generateInterviewAnswer,
  libraryRepository,
  libraryService,
} from "./services";
import type { StructuredGenerate } from "./structured";
import { playgroundControlStore } from "./workspace-control";

type ApiEnvironment = {
  Variables: {
    requestId: string;
  };
};

// Request bounds. The JSON bound covers every route; the code-execution routes
// (/run, /run-all, /syntax-check, /react-preview) hand the body to a container
// or the bundler, so they take a tighter body and per-field caps.
const JSON_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
// A coach's ledger: its notes' summaries, its log and a design, no more.
const COACH_LEDGER_LIMIT_BYTES = 256 * 1024;
const EXECUTION_BODY_LIMIT_BYTES = 1024 * 1024;
const MAX_CODE_CHARS = 200_000;
const MAX_STDIN_CHARS = 64_000;

function apiError(
  context: Context<ApiEnvironment>,
  status: 400 | 401 | 404 | 409 | 413 | 500 | 502 | 503,
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

// The body is read as a stream against its limit; every refusal is fixed text
// that quotes nothing from the request.
async function readBody(context: Context<ApiEnvironment>, limit: number) {
  const body = await readBoundedJson(context.req.raw, limit);
  if (body.ok) return body;
  return {
    ok: false as const,
    response:
      body.reason === "too-large"
        ? apiError(
            context,
            413,
            "payload_too_large",
            "The request is too large.",
          )
        : apiError(
            context,
            400,
            "invalid_request",
            "The request body must be valid JSON.",
          ),
  };
}

// [GUARD] The execution routes cap what reaches the runner or the bundler.
function exceedsExecutionBounds(input: {
  code: string;
  usageCode?: string;
  testCode?: string;
  stdin?: string;
}): boolean {
  return (
    input.code.length > MAX_CODE_CHARS ||
    (input.usageCode?.length ?? 0) > MAX_CODE_CHARS ||
    (input.testCode?.length ?? 0) > MAX_CODE_CHARS ||
    (input.stdin?.length ?? 0) > MAX_STDIN_CHARS
  );
}

function executionTooLarge(context: Context<ApiEnvironment>) {
  return apiError(
    context,
    413,
    "payload_too_large",
    "The code or input is too large to run.",
  );
}

// A guide that fails validation is named by its schema path only; the path is
// the schema's, never request text.
class PlaygroundGuideInvalidError extends Error {
  constructor(readonly path: string) {
    super("The Playground answer guide is invalid.");
    this.name = "PlaygroundGuideInvalidError";
  }
}

// [GUARD] A pushed answer becomes a Workspace answer: its guide must be valid,
// and its Markdown is the guide's rendering, never the pushed text.
function withRenderedPlaygroundAnswer(patch: PlaygroundPatch): PlaygroundPatch {
  if (!patch.answer) return patch;
  const guide = answerGuideSchema.safeParse(patch.answer.guide);
  if (!guide.success) {
    const issue = guide.error.issues[0];
    throw new PlaygroundGuideInvalidError(
      ["guide", ...(issue?.path ?? [])].join("."),
    );
  }
  return {
    ...patch,
    answer: {
      ...patch.answer,
      guide: guide.data,
      answerMarkdown: renderGuideMarkdown(guide.data),
    },
  };
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
    return apiError(
      context,
      409,
      "slug_conflict",
      "A Library item with that slug already exists.",
    );
  }
  if (error instanceof LibraryStateError) {
    return apiError(
      context,
      409,
      "invalid_library_state",
      "The Library item cannot be changed in its current state.",
    );
  }
  if (error instanceof LibraryIndexUnavailableError) {
    return apiError(
      context,
      503,
      "library_index_unavailable",
      "The Library search index could not be loaded or rebuilt.",
    );
  }
  throw error;
}

// [SAFETY] HO-SEC-02: one gate for /api/v1. A request is let in only by
// proof the server can check, never by a header the client chose:
//   1. the configured INTERVIEW_API_TOKEN as a bearer (the CLI, scripts), or
//   2. a verified signed-in session (the browser UI) from the host's
//      `verifySession`, which resolves the member of the tenant the request names.
// With no token configured the bearer path is closed, not open: a non-browser
// caller without a session is refused. `Origin` and `Sec-Fetch-Site` can only
// narrow the session path (a browser marking the request cross-site is
// refused); they never grant access. Every refusal is the same fixed 401.
function bearerMatches(authorization: string | undefined, token: string) {
  if (!token || !authorization) return false;
  // Equal-length digests keep the comparison constant-time for any input length.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization), digest(`Bearer ${token}`));
}

// An Origin is compared with the Host the browser used, never with the origin of
// the request URL: `next start --hostname 127.0.0.1` builds that URL as
// localhost even for a call to 127.0.0.1, which made every POST from the
// signed-in page look cross-site. The Host header can only narrow this path
// (the session is still verified), so trusting it here grants nothing.
function browserSaysCrossSite(context: Context<ApiEnvironment>) {
  const origin = context.req.header("origin");
  if (context.req.header("sec-fetch-site") === "cross-site") return true;
  if (origin === undefined) return false;
  const host = context.req.header("host") ?? new URL(context.req.url).host;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

function authenticate(options: InterviewApiOptions) {
  return async (context: Context<ApiEnvironment>, next: Next) => {
    const token = process.env["INTERVIEW_API_TOKEN"] ?? "";
    if (bearerMatches(context.req.header("authorization"), token)) {
      return next();
    }
    let signedIn = false;
    if (!browserSaysCrossSite(context)) {
      try {
        signedIn = (await options.verifySession?.(context.req.raw)) === true;
      } catch {
        // A failing verifier is no session: the gate fails closed.
        signedIn = false;
      }
    }
    if (!signedIn) {
      return apiError(
        context,
        401,
        "unauthorized",
        "A valid API token or signed-in session is required.",
      );
    }
    return next();
  };
}

// [SAFETY] Failures are logged as metadata only: the route and the error's
// class and code, never its message, which can quote the request or a reply.
function logFailure(
  context: Context<ApiEnvironment>,
  route: string,
  error: unknown,
) {
  console.error(
    JSON.stringify({
      route,
      requestId: context.get("requestId"),
      error: error instanceof Error ? error.name : "non-error",
      ...(error instanceof WorkspaceError ? { code: error.code } : {}),
    }),
  );
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
  // Whether the request carries a verified signed-in session for the tenant it
  // names (HO-SEC-02). Absent means no browser session is ever accepted.
  verifySession?: (request: Request) => Promise<boolean>;
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,255}$/;

export function createApi(options: InterviewApiOptions) {
  const app = new Hono<ApiEnvironment>();

  app.use("*", async (context, next) => {
    // [SAFETY] HO-SEC-03: a client id is echoed only when bounded and made of
    // safe characters; anything else is replaced, never trimmed.
    const supplied = context.req.header("x-request-id");
    context.set(
      "requestId",
      supplied !== undefined && REQUEST_ID.test(supplied)
        ? supplied
        : randomUUID(),
    );
    await next();
    context.header("x-request-id", context.get("requestId") as string);
  });
  app.use("/api/v1/*", authenticate(options));

  app.get("/api/fake/v1/models", (context) =>
    context.json({
      object: "list",
      data: [{ id: "fake-interview-model", object: "model" }],
    }),
  );

  app.post("/api/fake/v1/chat/completions", async (context) => {
    const read = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!read.ok) return read.response;
    const body = read.value as {
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
          guide: {
            version: 1,
            understand: {
              prompt: "Return the supplied values unchanged.",
              examples: [{ input: "[1, 2, 3]", output: "[1, 2, 3]" }],
              constraints: [],
              clarify: [],
            },
            plan: {
              steps: [
                "Start with the smallest correct implementation, verify the primary example, then discuss only improvements justified by the constraints.",
              ],
              complexity: {
                time: "O(n)",
                space: "O(n)",
                note: "for the returned collection",
              },
            },
            edgeCases: [],
            explain: [
              {
                heading: "The approach",
                body: "Keep the baseline explicit so it is easy to adapt.",
              },
            ],
            talkingPoints: [
              "Start simple.",
              "Verify the primary example.",
              "Improve only for a stated constraint.",
            ],
          },
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
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = libraryItemInputSchema.safeParse(body.value);
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
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = libraryItemInputSchema.safeParse(body.value);
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
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = routeRequestSchema.safeParse(body.value);
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
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = generateRequestSchema.safeParse(body.value);
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
      logFailure(context, "generate", error);
      return generationFailure(context, error, "an answer");
    }
  });

  app.post("/api/v1/explain", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = explanationRequestSchema.safeParse(body.value);
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
      logFailure(context, "explain", error);
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
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = saveExplanationRequestSchema.safeParse(body.value);
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

  // Coach notes for the live window: read by the page, written by a coach.
  // A reader that names the revision it already shows is answered with no
  // content while nothing has changed, so it can ask often (a note grows on
  // screen as its coach writes it) at almost no cost.
  // `?space=replay` reads and writes the notes of a replay, which are kept
  // apart from the person's own.
  const notesOf = (context: Context<ApiEnvironment>) =>
    context.req.query("space") === "replay" ? replayCoachNotes : coachNotes;
  app.get("/api/v1/coach-notes", (context) => {
    const held = notesOf(context).get();
    return context.req.query("revision") === String(held.revision)
      ? context.body(null, 204)
      : context.json(held);
  });
  app.post("/api/v1/coach-notes", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = coachNoteInputSchema.safeParse(body.value);
    // [SAFETY] The issue paths only: a note's text never goes into an error.
    if (!parsed.success)
      return apiError(
        context,
        400,
        "invalid_coach_note",
        "The coach note is invalid.",
        parsed.error.issues.map((issue) => issue.path.join(".")),
      );
    // [SAFETY] A note is checked against who holds the pen and against the
    // conversation it was written from, here, where both are known: a coach
    // that was replaced, or one still writing about a conversation that has
    // been cleared, cannot put a note on screen however late it arrives.
    const writer = context.req.header(WRITER_HEADER);
    if (writer !== undefined) {
      const claim = parseWriter(writer);
      if (!claim || !coachWriters.accepts(claim))
        return apiError(
          context,
          409,
          "stale_writer",
          "Another coach holds the notes.",
        );
    }
    const conversation = context.req.header(CONVERSATION_HEADER);
    if (
      conversation !== undefined &&
      conversation !== coachTranscript.since(Number.MAX_SAFE_INTEGER).epoch
    )
      return apiError(
        context,
        409,
        "stale_conversation",
        "The conversation this note was written from is over.",
      );
    const added = notesOf(context).add(parsed.data);
    // An older revision of a note already held: refused, nothing changed.
    if (!added)
      return apiError(
        context,
        409,
        "stale_coach_note",
        "A newer revision of this note is already held.",
      );
    return context.json(added, 201);
  });
  // Clearing the notes clears what the coach read to write them.
  app.delete("/api/v1/coach-notes", (context) => {
    // Only the conversation those notes were written from is cleared with
    // them: closing a replay leaves a live session's transcript alone.
    const space = context.req.query("space") === "replay" ? "replay" : "live";
    if (coachTranscript.since(Number.MAX_SAFE_INTEGER).space === space)
      coachTranscript.clear();
    return context.json(notesOf(context).clear());
  });

  // The coach's ledger of the conversation in hand: kept by the coach, held
  // here with the transcript, so a restarted coach does not start again.
  app.get("/api/v1/coach-ledger", (context) => {
    const kept = coachTranscript.ledger(context.req.query("epoch") ?? "");
    return kept === undefined
      ? context.body(null, 204)
      : context.json({ ledger: kept });
  });
  app.put("/api/v1/coach-ledger", async (context) => {
    const body = await readBody(context, COACH_LEDGER_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const kept = (body.value as { ledger?: { epoch?: unknown } } | null)
      ?.ledger;
    if (
      typeof kept !== "object" ||
      kept === null ||
      typeof kept.epoch !== "string"
    )
      return apiError(
        context,
        400,
        "invalid_coach_ledger",
        "A ledger names the conversation it is of.",
      );
    // A ledger of a conversation that is over is not kept.
    return coachTranscript.setLedger(kept.epoch, kept)
      ? context.body(null, 204)
      : apiError(
          context,
          409,
          "stale_conversation",
          "The conversation this ledger is of is over.",
        );
  });

  // Who holds the pen: a coach claims it, renews it, and gives it up.
  app.post("/api/v1/coach-writer", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const asked = body.value as {
      id?: unknown;
      takeover?: unknown;
      leaseSeconds?: unknown;
    } | null;
    if (typeof asked?.id !== "string" || !/^[\w.-]{1,64}$/.test(asked.id))
      return apiError(
        context,
        400,
        "invalid_coach_writer",
        "A coach names itself in letters, digits, dots and dashes.",
      );
    const claim = coachWriters.claim(asked.id, {
      takeover: asked.takeover === true,
      ...(typeof asked.leaseSeconds === "number"
        ? { leaseMs: asked.leaseSeconds * 1000 }
        : {}),
    });
    return claim
      ? context.json(claim)
      : apiError(context, 409, "coach_held", "Another coach holds the notes.");
  });
  app.delete("/api/v1/coach-writer", (context) => {
    coachWriters.release(context.req.query("id") ?? "");
    return context.body(null, 204);
  });

  // The plan for the call: written by the person, read by the coach.
  app.get("/api/v1/coach-plan", (context) => context.json(coachPlan.get()));
  app.put("/api/v1/coach-plan", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const text = (body.value as { text?: unknown } | null)?.text;
    if (typeof text !== "string" || text.length > COACH_PLAN_LENGTH)
      return apiError(
        context,
        400,
        "invalid_coach_plan",
        "The plan is text of at most a page.",
      );
    return context.json(coachPlan.set(text));
  });

  // The coach's transcript: read by the coach, written by a live session (as
  // it hears) or by a person attaching one. Held in memory only.
  app.get("/api/v1/coach-transcript", (context) => {
    const after = Number(context.req.query("after") ?? "0");
    return context.json(
      coachTranscript.since(Number.isInteger(after) && after > 0 ? after : 0),
    );
  });
  app.post("/api/v1/coach-transcript", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = coachTranscriptInputSchema.safeParse(body.value);
    // [SAFETY] The issue paths only: what was said never goes into an error.
    if (!parsed.success)
      return apiError(
        context,
        400,
        "invalid_coach_transcript",
        "The transcript is invalid.",
        parsed.error.issues.slice(0, 20).map((issue) => issue.path.join(".")),
      );
    return context.json(coachTranscript.add(parsed.data.lines), 201);
  });
  // Who is speaking, from whoever can tell (an audio source's voice activity).
  app.post("/api/v1/coach-activity", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = coachActivityInputSchema.safeParse(body.value);
    if (!parsed.success)
      return apiError(
        context,
        400,
        "invalid_coach_activity",
        "The activity is invalid.",
      );
    coachTranscript.setSpeaking(parsed.data.speaker, parsed.data.speaking);
    return context.body(null, 204);
  });
  app.delete("/api/v1/coach-transcript", (context) =>
    context.json(coachTranscript.clear()),
  );

  app.get("/api/v1/playground-control", (context) =>
    context.json(playgroundControlStore.get()),
  );

  app.patch("/api/v1/playground-control", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    try {
      return context.json(
        playgroundControlStore.set(
          withRenderedPlaygroundAnswer(parsePlaygroundPatch(body.value)),
        ),
      );
    } catch (error) {
      // The parser's messages quote the pushed fields, so they stay out of the
      // response; a bad guide is named by its schema path.
      return apiError(
        context,
        400,
        "invalid_playground_update",
        "The Playground update is invalid.",
        error instanceof PlaygroundGuideInvalidError ? [error.path] : undefined,
      );
    }
  });

  app.post("/api/v1/playground-control/explanations", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    try {
      return context.json(
        playgroundControlStore.appendExplanation(
          parsePlaygroundExplanation(body.value),
        ),
      );
    } catch {
      return apiError(
        context,
        400,
        "invalid_explanation_append",
        "The Playground explanation is invalid.",
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
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = saveAnswerRequestSchema.safeParse(body.value);
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
    const body = await readBody(context, EXECUTION_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = runRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The execution request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    if (exceedsExecutionBounds(parsed.data)) return executionTooLarge(context);
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
    const body = await readBody(context, EXECUTION_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = syntaxCheckRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The syntax-check request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    if (exceedsExecutionBounds(parsed.data)) return executionTooLarge(context);
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
    const body = await readBody(context, EXECUTION_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = runAllRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The complete execution request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    if (exceedsExecutionBounds(parsed.data)) return executionTooLarge(context);
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
    const read = await readBody(context, EXECUTION_BODY_LIMIT_BYTES);
    if (!read.ok) return read.response;
    const body = (read.value ?? {}) as {
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
    if (exceedsExecutionBounds({ code: body.code })) {
      return executionTooLarge(context);
    }
    const componentName =
      typeof body.componentName === "string" &&
      /^[A-Z][A-Za-z0-9_]*$/.test(body.componentName)
        ? body.componentName
        : "App";

    try {
      return context.json({
        javascript: await bundleReactPreview(body.code, componentName),
      });
    } catch (error) {
      logFailure(context, "react-preview", error);
      return apiError(
        context,
        400,
        "compile_failed",
        error instanceof PreviewImportRefusedError ||
          error instanceof PreviewCompileError
          ? error.message
          : "The preview code could not be compiled.",
      );
    }
  });

  // [SAFETY] A failure no route handled is answered with fixed text; Hono's
  // default would log the error's message, which can quote the request.
  app.onError((error, context) => {
    logFailure(context, "unhandled", error);
    return apiError(context, 500, "internal_error", "The request failed.");
  });

  app.notFound((context) =>
    apiError(context, 404, "not_found", "The API route was not found."),
  );

  return app;
}
