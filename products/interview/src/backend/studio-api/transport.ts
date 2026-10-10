import { readBoundedJson } from "@omnitech/platform-contracts";
import type { Context } from "hono";
import { WorkspaceError, type WorkspaceScope } from "../assistant/workspace";
import type { StructuredGenerate } from "../structured";

export type ApiEnvironment = {
  Variables: {
    requestId: string;
  };
};

// Request bounds. The JSON bound covers every route; the code-execution routes
// (/run, /run-all, /syntax-check, /react-preview) hand the body to a container
// or the bundler, so they take a tighter body and per-field caps.
export const JSON_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
// A coach's ledger: its notes' summaries, its log and a design, no more.
export const COACH_LEDGER_LIMIT_BYTES = 256 * 1024;
export const EXECUTION_BODY_LIMIT_BYTES = 1024 * 1024;

export function apiError(
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
export async function readBody(
  context: Context<ApiEnvironment>,
  limit: number,
) {
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

// [SAFETY] Failures are logged as metadata only: the route and the error's
// class and code, never its message, which can quote the request or a reply.
export function logFailure(
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
export function generationFailure(
  context: Context,
  error: unknown,
  what: string,
) {
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

export type ApiApp = import("hono").Hono<ApiEnvironment>;
