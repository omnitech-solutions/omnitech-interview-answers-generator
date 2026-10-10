# products/interview/src/backend/api.ts

_Source: `products/interview/src/backend/api.ts` (header-comment fallback)_

[SAFETY] HO-SEC-02: one gate for /api/v1. A request is let in only by
proof the server can check, never by a header the client chose:
1. the configured INTERVIEW_API_TOKEN as a bearer (the CLI, scripts), or
2. a verified signed-in session (the browser UI) from the host's
`verifySession`, which resolves the member of the tenant the request names.
With no token configured the bearer path is closed, not open: a non-browser
caller without a session is refused. `Origin` and `Sec-Fetch-Site` can only
narrow the session path (a browser marking the request cross-site is
refused); they never grant access. Every refusal is the same fixed 401.
