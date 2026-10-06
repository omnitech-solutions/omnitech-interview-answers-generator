import { createHash, timingSafeEqual } from "node:crypto";

import {
  runAllRequestSchema,
  runRequestSchema,
  syntaxCheckRequestSchema,
} from "@omnitech/interview-contracts";

import type { CodeRunner } from "./index";

// [DOMAIN] The code runner as a small service. Docker is only reachable from the
// host, so when the web app runs in a container the host runs this and the web
// app calls it through RemoteCodeRunner. It answers exactly the CodeRunner calls.
// [SAFETY] It executes submitted code (in the runner's sandboxed containers), so
// every call needs the shared bearer token, the body is bounded, and the caller
// is expected to be loopback-only (the host script binds 127.0.0.1).

const MAX_BODY_BYTES = 1024 * 1024;
const MIN_TOKEN_LENGTH = 24;

// Structural, so this package needs no schema library of its own.
type Schema = {
  safeParse(
    value: unknown,
  ): { success: true; data: unknown } | { success: false };
};
type Route = {
  schema: Schema;
  call(runner: CodeRunner, input: never): Promise<unknown>;
};

const routes: Record<string, Route> = {
  "/run": {
    schema: runRequestSchema,
    call: (runner, input) => runner.run(input),
  },
  "/run-all": {
    schema: runAllRequestSchema,
    call: (runner, input) => runner.runAll(input),
  },
  "/syntax-check": {
    schema: syntaxCheckRequestSchema,
    call: (runner, input) => runner.checkSyntax(input),
  },
};

const digest = (text: string) => createHash("sha256").update(text).digest();
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

export function createRunnerHandler(
  runner: CodeRunner,
  token: string,
): (request: Request) => Promise<Response> {
  if (token.length < MIN_TOKEN_LENGTH)
    throw new Error("The runner service needs a token of 24+ characters.");
  const expected = digest(token);
  return async (request) => {
    // [GUARD] Both digests are the same length, so the compare is constant-time.
    const presented = digest(
      (request.headers.get("authorization") ?? "").replace(/^Bearer /i, ""),
    );
    if (!timingSafeEqual(expected, presented))
      return reply(401, { error: "unauthorized" });
    const route = routes[new URL(request.url).pathname];
    if (!route) return reply(404, { error: "not_found" });
    if (request.method !== "POST") return reply(405, { error: "method" });
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES)
      return reply(413, { error: "too_large" });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return reply(400, { error: "invalid_request" });
    }
    const parsed = route.schema.safeParse(body);
    if (!parsed.success) return reply(400, { error: "invalid_request" });
    try {
      return reply(200, await route.call(runner, parsed.data as never));
    } catch {
      // The reason (a missing Docker, a failed image) is for the host's log.
      return reply(503, { error: "runner_unavailable" });
    }
  };
}
