// Route classification (AGENTS.md rule 4, INV-0004; decision D18). Every route
// `createApplicationApi()` mounts must be named in the table below with the
// kind of caller identity it asks for TODAY. This is a documentation guard for
// the deferred authentication phase: it describes the current behaviour (the
// app runs as the default local user, authentication is inferred) and fails
// only when a NEW route appears unclassified, or a row stops matching any
// route. It enforces no auth and never fails on default-user behaviour.
//
// Classes:
//   public               no caller identity is read at all
//   session              needs a signed-in user, with no tenant membership
//   membership-resolved  resolves the tenant's member (resolveContext) before
//                        any domain work; a non-member sees 401/404
//   credential           a bearer or unguessable token stands in for the user
//   middleware           a catch-all registration that gates or forwards; it
//                        carries no domain work itself
// The table is configuration, not suppression: each row has a written reason.
import { afterAll, beforeAll, expect, it, vi } from "vitest";

// These guards parse much of the repository with the compiler API; on a busy
// machine that outlasts the 10 s default test timeout.
vi.setConfig({ testTimeout: 120_000 });

// The sign-in session is the identity boundary and is out of scope here.
vi.mock("@/auth", () => ({ auth: async () => null }));

type RouteClass =
  | "public"
  | "session"
  | "membership-resolved"
  | "credential"
  | "middleware";

interface RouteRule {
  method: string;
  // A trailing `*` matches any path with that prefix (a method of `ALL` is a
  // catch-all registration and always matches exactly); otherwise exact.
  path: string;
  class: RouteClass;
  reason: string;
}

const platformMember =
  "resolves the tenant member through resolvePlatformContext before reading";
const interviewMember =
  "resolves the signed-in member of the tenant the request names before domain work";

// First match wins, so specific rows precede their prefix rows.
const rules: readonly RouteRule[] = [
  {
    method: "POST",
    path: "/api/interview/t/:tenantSlug/sessions/ingest",
    class: "credential",
    reason:
      "companion ingest: the session credential in the Authorization header is the principal; no user session is read (ADR-0012)",
  },
  {
    method: "ALL",
    path: "/api/interview/t/:tenantSlug/sessions/*",
    class: "middleware",
    reason:
      "session-routes guards: refuse unsigned requests for the user routes and skip the credential-authenticated ingest",
  },
  {
    method: "*",
    path: "/api/interview/t/:tenantSlug/sessions*",
    class: "membership-resolved",
    reason: `Active Session user routes: ${interviewMember}; the actor is the context user`,
  },
  {
    method: "ALL",
    path: "/*",
    class: "middleware",
    reason:
      "the interview API's request-id middleware; it reads no identity and runs before every route",
  },
  {
    method: "ALL",
    path: "/api/v1/*",
    class: "middleware",
    reason:
      "the optional INTERVIEW_API_TOKEN gate on the answers API (same-origin requests pass without a token); membership is not resolved here (deferred auth phase)",
  },
  {
    method: "GET",
    path: "/api/v1/health",
    class: "public",
    reason: "liveness probe; returns no tenant data",
  },
  {
    method: "*",
    path: "/api/v1/*",
    class: "credential",
    reason:
      "answers, library, explanations, playground control and code execution: gated only by the optional shared API token or a same-origin request, with no tenant membership today (deferred auth phase, tracked in the redesign plan)",
  },
  {
    method: "*",
    path: "/api/fake/v1/*",
    class: "public",
    reason:
      "the deterministic fake model used for local development; it reads and stores nothing",
  },
  {
    method: "ALL",
    path: "/api/interview/documents/*",
    class: "middleware",
    reason: "documents API guards ahead of the document routes",
  },
  {
    method: "*",
    path: "/api/interview/documents*",
    class: "membership-resolved",
    reason: `candidate documents: ${interviewMember}; writes also need the write permission`,
  },
  {
    method: "ALL",
    path: "/api/assistant/*",
    class: "membership-resolved",
    reason:
      "forwards to the studio app, which scopes every request to the member",
  },
  {
    method: "ALL",
    path: "/api/interview/*",
    class: "membership-resolved",
    reason:
      "forwards to the studio app (drafts, plan, briefs, briefing packs, rehearsals), each scoped to the member",
  },
  {
    method: "GET",
    path: "/api/presentation/v1/shared/:token",
    class: "credential",
    reason: "a shared presentation is read by its unguessable share token",
  },
  {
    method: "*",
    path: "/api/presentation/v1/*",
    class: "membership-resolved",
    reason: "presentation routes resolve the tenant member through contextFor",
  },
  {
    method: "GET",
    path: "/api/platform/v1/agent-jobs/:id/events",
    class: "membership-resolved",
    reason:
      "a member reads their own job's events; the internal agent worker may instead present AGENT_SERVICE_TOKEN with a tenantId, then reads within that tenant only",
  },
  {
    method: "*",
    path: "/api/platform/v1/*",
    class: "membership-resolved",
    reason: platformMember,
  },
];

const matches = (rule: RouteRule, method: string, path: string) =>
  (rule.method === "*" || rule.method === method) &&
  (rule.path.endsWith("*") && rule.method !== "ALL"
    ? path.startsWith(rule.path.slice(0, -1))
    : rule.path === path);

let routes: Array<{ method: string; path: string }> = [];
beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://guard:guard@127.0.0.1:1/guard");
  const { createApplicationApi } = await import(
    "../apps/web/src/platform/api.js"
  );
  routes = createApplicationApi().routes.map(({ method, path }) => ({
    method,
    path,
  }));
});
afterAll(() => {
  vi.unstubAllEnvs();
});

it("mounts a recognisable set of routes", () => {
  expect(routes.length).toBeGreaterThan(80);
  expect(routes).toContainEqual({
    method: "GET",
    path: "/api/platform/v1/context",
  });
});

it("classifies every mounted route", () => {
  const unclassified = routes
    .filter(
      ({ method, path }) => !rules.some((rule) => matches(rule, method, path)),
    )
    .map(({ method, path }) => `${method} ${path}`);
  expect(
    unclassified,
    `Add each new route to the table in scripts/route-classification.test.ts with the identity it asks for and a reason:\n${unclassified.join("\n")}`,
  ).toEqual([]);
});

it("keeps every classification row real and reasoned", () => {
  for (const rule of rules) {
    expect(rule.reason.length, rule.path).toBeGreaterThan(30);
    expect(
      routes.some(({ method, path }) => {
        const first = rules.find((candidate) =>
          matches(candidate, method, path),
        );
        return first === rule;
      }),
      `${rule.method} ${rule.path} classifies no route (stale row or shadowed by an earlier row)`,
    ).toBe(true);
  }
});

it("keeps public writes to the one known route", () => {
  // A public row for a write is a deliberate decision, so it is listed here.
  const publicWrites = routes
    .filter(({ method, path }) => {
      const rule = rules.find((candidate) => matches(candidate, method, path));
      return (
        rule?.class === "public" && !["GET", "HEAD", "ALL"].includes(method)
      );
    })
    .map(({ method, path }) => `${method} ${path}`);
  expect(publicWrites).toEqual(["POST /api/fake/v1/chat/completions"]);
});
