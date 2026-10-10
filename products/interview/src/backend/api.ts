import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import {
  mountAnswerItemRoutes,
  mountAnswerListRoute,
} from "./studio-api/answers.routes";
import { mountCoachNoteRoutes } from "./studio-api/coach-notes.routes";
import { mountCoachSettingsRoutes } from "./studio-api/coach-settings.routes";
import {
  mountCoachLedgerRoutes,
  mountCoachTranscriptRoutes,
} from "./studio-api/conversation.routes";
import { mountExecutionRoutes } from "./studio-api/execution.routes";
import { mountExplanationRoutes } from "./studio-api/explanations.routes";
import { mountFakeRoutes } from "./studio-api/fake.routes";
import { mountGenerationRoutes } from "./studio-api/generation.routes";
import { mountLibraryRoutes } from "./studio-api/library.routes";
import { mountPlaygroundRoutes } from "./studio-api/playground.routes";
import {
  type ApiEnvironment,
  apiError,
  type InterviewApiOptions,
  logFailure,
} from "./studio-api/transport";

export type { InterviewApiOptions } from "./studio-api/transport";

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

  mountFakeRoutes(app);

  app.get("/api/v1/health", (context) =>
    context.json({ ok: true, aiConfigured: options.generate !== undefined }),
  );

  mountLibraryRoutes(app);
  mountGenerationRoutes(app, options);
  mountExplanationRoutes(app);
  mountAnswerListRoute(app);
  mountCoachNoteRoutes(app);
  mountCoachLedgerRoutes(app);
  mountCoachSettingsRoutes(app);
  mountCoachTranscriptRoutes(app);
  mountPlaygroundRoutes(app);
  mountAnswerItemRoutes(app);
  mountExecutionRoutes(app);

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
