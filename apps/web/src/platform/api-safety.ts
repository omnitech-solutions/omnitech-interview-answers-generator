import type { ErrorHandler, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

// [DOMAIN] Two rules every `/api/*` route shares, so no sub-app has to repeat
// them: where a mutating request may come from, and what an unexpected error
// says.

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// [SAFETY] The browser sends `Origin` and `Sec-Fetch-Site` itself and a page
// cannot forge either, so they can only narrow access. A request with neither
// (the CLI's bearer call, the Mac app's own HTTP client) is not a browser and
// is judged by the route's own auth. The comparison is on the host the request
// was sent to, so a TLS-terminating proxy that turns https into http does not
// lock real users out. Unlike Hono's `csrf()`, this applies to every content
// type: the handlers call `req.json()` whatever the header says.
function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const originGuard: MiddlewareHandler = async (context, next) => {
  if (!MUTATING.has(context.req.method)) return next();
  const origin = context.req.header("origin");
  const host = context.req.header("host") ?? new URL(context.req.url).host;
  if (
    context.req.header("sec-fetch-site") === "cross-site" ||
    (origin !== undefined && !sameHost(origin, host))
  )
    return context.json(
      {
        error: {
          code: "origin_forbidden",
          message: "Cross-site requests are not allowed.",
        },
      },
      403,
    );
  return next();
};

// [SAFETY] A fixed body: an error's text can quote a prompt, a note or a
// credential (AGENTS rule 8). Only the error's class is logged.
export const apiErrorHandler: ErrorHandler = (error, context) => {
  if (error instanceof HTTPException) {
    return context.json(
      { error: { code: "request_failed", message: "Request failed." } },
      error.status,
    );
  }
  console.error(
    JSON.stringify({
      apiError: error instanceof Error ? error.name : "unknown",
    }),
  );
  return context.json(
    { error: { code: "internal_error", message: "Something went wrong." } },
    500,
  );
};
