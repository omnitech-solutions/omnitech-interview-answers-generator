import { describe, expect, it, vi } from "vitest";
import { createSessionClient, SessionApiError } from "./session-client";
import {
  jsonResponse,
  SESSION_ID,
  sessionView,
  streamPage,
} from "./testing/session-fixtures";

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

  it("posts owner input to the session's input route and reads the acknowledgement", async () => {
    const { client, calls } = clientWith(
      jsonResponse({ input: { requestId: "r-1", sequence: 4 } }, 202),
      jsonResponse({ error: { code: "status_refused" } }, 409),
    );
    const input = {
      requestId: "r-1",
      operation: "analyze" as const,
      snapshots: [{ sourceId: "screen", eventId: "evt-2" }],
    };
    await client.sendOwnerInput(SESSION_ID, input);
    expect(calls[0]?.url).toBe(`${base}/${SESSION_ID}/input`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(input);
    expect(
      await client.sendOwnerInput(SESSION_ID, input).catch((e) => e),
    ).toMatchObject({ code: "status_refused", status: 409 });
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

describe("screenshots on the answer page", () => {
  const T = { taskId: "task-a", revision: 2 };
  const ack = { input: { requestId: "r-1", sequence: 3 } };

  it("sends several images in order with one target, one request id and the text aligned by index", async () => {
    const { client, calls } = clientWith(
      jsonResponse(
        {
          ...ack,
          snapshots: [
            { sourceId: "studio.owner-capture", eventId: "r-1" },
            { sourceId: "studio.owner-capture", eventId: "r-1.2" },
          ],
        },
        202,
      ),
    );
    await client.sendCapture(SESSION_ID, {
      requestId: "r-1",
      images: [new Blob(["one"]), new Blob(["two"])],
      ocr: [{ engine: "vision", text: "hello" }, null],
      target: T,
    });
    expect(calls[0]?.url).toBe(`${base}/${SESSION_ID}/capture`);
    const form = calls[0]?.init?.body as FormData;
    expect(form.getAll("image")).toHaveLength(2);
    expect(
      await Promise.all(form.getAll("image").map((f) => (f as File).text())),
    ).toEqual(["one", "two"]);
    expect(form.get("requestId")).toBe("r-1");
    expect(form.get("targetTaskId")).toBe("task-a");
    expect(form.get("targetRevision")).toBe("2");
    expect(JSON.parse(String(form.get("ocr")))).toEqual([
      { engine: "vision", text: "hello" },
      null,
    ]);
  });

  it("sends the display list aligned with the images, and no field when none is known", async () => {
    const response = () =>
      jsonResponse(
        {
          ...ack,
          snapshots: [
            { sourceId: "studio.owner-capture", eventId: "r-1" },
            { sourceId: "studio.owner-capture", eventId: "r-1.2" },
          ],
        },
        202,
      );
    const { client, calls } = clientWith(response(), response());
    const display = { name: "Studio Display", index: 2, count: 3 };
    await client.sendCapture(SESSION_ID, {
      requestId: "r-1",
      images: [new Blob(["one"]), new Blob(["two"])],
      display: [display, null],
    });
    expect(
      JSON.parse(String((calls[0]?.init?.body as FormData).get("display"))),
    ).toEqual([display, null]);
    await client.sendCapture(SESSION_ID, {
      requestId: "r-2",
      images: [new Blob(["one"]), new Blob(["two"])],
      display: [null, null],
    });
    expect((calls[1]?.init?.body as FormData).has("display")).toBe(false);
  });

  it("sends no ocr field when no image was read, and no target for a new task", async () => {
    const { client, calls } = clientWith(
      jsonResponse(
        {
          ...ack,
          snapshots: [{ sourceId: "studio.owner-capture", eventId: "r-1" }],
        },
        202,
      ),
    );
    await client.sendCapture(SESSION_ID, {
      requestId: "r-1",
      images: [new Blob(["one"])],
      ocr: [null],
    });
    const form = calls[0]?.init?.body as FormData;
    expect(form.has("ocr")).toBe(false);
    expect(form.has("targetTaskId")).toBe(false);
  });

  it("regenerates with the target and no text, and lists a task's screenshots through the contract", async () => {
    const listing = {
      taskId: "task-a",
      screenshots: [
        {
          ordinal: 3,
          sourceId: "s",
          eventId: "e",
          sequence: 5,
          capturedAt: "2026-10-05T10:00:00.000Z",
          artifactId: "art 1",
          ocrEngine: null,
          display: { name: "Studio Display", index: 1, count: 2 },
          revisions: [1, 2],
        },
      ],
    };
    const { client, calls } = clientWith(
      jsonResponse(ack, 202),
      jsonResponse(listing),
      jsonResponse({ taskId: "task-a", screenshots: [{ bad: true }] }),
    );
    await client.regenerate(SESSION_ID, "r-1", T);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      requestId: "r-1",
      operation: "regenerate",
      target: T,
      snapshots: [],
    });
    expect(await client.listTaskScreenshots(SESSION_ID, "task a")).toEqual(
      listing,
    );
    expect(calls[1]?.url).toBe(
      `${base}/${SESSION_ID}/tasks/task%20a/screenshots`,
    );
    await expect(
      client.listTaskScreenshots(SESSION_ID, "task-a"),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(client.screenshotUrl(SESSION_ID, "art/1")).toBe(
      `${base}/${SESSION_ID}/screenshots/art%2F1`,
    );
  });

  it("surfaces the fixed code and the refusal reason of a stale or device-only refusal", async () => {
    const { client } = clientWith(
      jsonResponse({ error: { code: "status_refused" } }, 409, {
        "x-refusal-reason": "stale_target",
      }),
    );
    const failure = await client
      .regenerate(SESSION_ID, "r-1", T)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SessionApiError);
    expect((failure as SessionApiError).reason).toBe("stale_target");
    // A later failure without a reason carries none: no module-global leak.
    const later = clientWith(
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    const second = await later.client
      .regenerate(SESSION_ID, "r-2", T)
      .catch((error: unknown) => error);
    expect((second as SessionApiError).reason).toBeNull();
    expect((failure as SessionApiError).reason).toBe("stale_target");
  });
});
