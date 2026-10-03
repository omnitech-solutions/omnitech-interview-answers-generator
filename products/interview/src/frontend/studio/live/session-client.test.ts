import { describe, expect, it, vi } from "vitest";
import { createSessionClient, SessionApiError } from "./session-client";
import {
  jsonResponse,
  SESSION_ID,
  sessionView,
  streamPage,
} from "./session-fixtures";

function clientWith(...responses: (Response | Error)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: createSessionClient("local", fetcher), calls };
}

const base = "/api/interview/t/local/sessions";

describe("session client", () => {
  it("reads the current session, and an absent one as null", async () => {
    const { client, calls } = clientWith(
      jsonResponse({ session: sessionView() }),
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    expect((await client.current())?.id).toBe(SESSION_ID);
    expect(await client.current()).toBeNull();
    expect(calls[0]?.url).toBe(`${base}/current`);
  });

  it("encodes the tenant and the session id in every path", async () => {
    const calls: string[] = [];
    const client = createSessionClient("a b", async (url) => {
      calls.push(url);
      return jsonResponse({ session: sessionView() });
    });
    await client.get("x/y");
    expect(calls).toEqual(["/api/interview/t/a%20b/sessions/x%2Fy"]);
  });

  it("pages the stream with both cursors", async () => {
    const page = streamPage();
    const { client, calls } = clientWith(jsonResponse(page));
    await client.stream(SESSION_ID, {
      afterSequence: 7,
      actionCursor: "c 1",
      limit: 50,
    });
    expect(calls[0]?.url).toBe(
      `${base}/${SESSION_ID}/stream?afterSequence=7&actionCursor=c+1&limit=50`,
    );
  });

  it("starts a session and returns the credential once", async () => {
    const { client, calls } = clientWith(
      jsonResponse(
        {
          session: sessionView({ status: "created" }),
          credential: {
            value: "secret-value",
            expiresAt: "2026-10-03T14:00:00Z",
          },
        },
        201,
      ),
    );
    const started = await client.start({
      processingPolicy: "device-only",
      captureSources: ["microphone"],
    });
    expect(started.credential.value).toBe("secret-value");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      processingPolicy: "device-only",
      captureSources: ["microphone"],
    });
  });

  it("sends the versioned control message", async () => {
    const { client, calls } = clientWith(
      jsonResponse({ session: sessionView({ status: "paused" }) }),
    );
    expect((await client.control(SESSION_ID, "pause")).status).toBe("paused");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      version: 1,
      kind: "session.control",
      action: "pause",
    });
    expect(calls[0]?.url).toBe(`${base}/${SESSION_ID}/control`);
  });

  it("renews and revokes the credential, tightens, shortens and deletes", async () => {
    const { client, calls } = clientWith(
      jsonResponse({
        credential: { value: "next", expiresAt: "2026-10-03T16:00:00Z" },
      }),
      new Response(null, { status: 204 }),
      jsonResponse({
        session: sessionView({ processingPolicy: "device-only" }),
      }),
      jsonResponse({ session: sessionView({ retention: "delete-at-end" }) }),
      jsonResponse({ session: sessionView({ status: "purging" }) }, 202),
    );
    expect((await client.renewCredential(SESSION_ID)).value).toBe("next");
    await client.revokeCredential(SESSION_ID);
    await client.tightenPolicy(SESSION_ID, "device-only");
    await client.shortenRetention(SESSION_ID, "delete-at-end");
    expect((await client.deleteSession(SESSION_ID)).status).toBe("purging");
    expect(
      calls.map(
        (call) =>
          `${call.init?.method} ${call.url.replace(`${base}/${SESSION_ID}`, "")}`,
      ),
    ).toEqual([
      "POST /credential",
      "DELETE /credential",
      "POST /policy",
      "POST /retention",
      "DELETE ",
    ]);
  });

  it("lists history and setup choices with parsed contracts", async () => {
    const { client, calls } = clientWith(
      jsonResponse({ sessions: [], nextCursor: null }),
      jsonResponse({ candidacies: [], profiles: [] }),
    );
    expect(
      (await client.list({ limit: 5, cursor: "c" })).nextCursor,
    ).toBeNull();
    expect((await client.choices()).profiles).toEqual([]);
    expect(calls[0]?.url).toBe(`${base}?limit=5&cursor=c`);
  });

  it("maps error bodies to their fixed code and status", async () => {
    const { client } = clientWith(
      jsonResponse({ error: { code: "credential_renewal_required" } }, 409),
    );
    const failure = await client.control(SESSION_ID, "resume").catch((e) => e);
    expect(failure).toBeInstanceOf(SessionApiError);
    expect(failure).toMatchObject({
      code: "credential_renewal_required",
      status: 409,
      message: "credential_renewal_required",
    });
  });

  it("never copies a response body into an error", async () => {
    const { client } = clientWith(
      new Response("<html>secret transcript text</html>", { status: 500 }),
    );
    const failure = await client.get(SESSION_ID).catch((e) => e);
    expect(failure).toMatchObject({ code: "invalid_response", status: 500 });
    expect(JSON.stringify(failure)).not.toContain("secret transcript");
    expect(String(failure.message)).not.toContain("secret transcript");
  });

  it("reports an unreachable server and an off-contract body", async () => {
    const { client } = clientWith(
      new TypeError("Failed to fetch"),
      jsonResponse({ session: { id: "not-a-session" } }),
    );
    expect(await client.get(SESSION_ID).catch((e) => e)).toMatchObject({
      code: "network",
      status: 0,
    });
    expect(await client.get(SESSION_ID).catch((e) => e)).toMatchObject({
      code: "invalid_response",
    });
  });
});
