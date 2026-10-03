// The no-content canary (rule:id-only-traces, rule:credential-storage,
// objective constraint: never log questions, transcripts, screenshots, prompts,
// generated content or credentials). One unique string is planted in a final
// transcript, in screenshot metadata, in a credential and in error paths, and
// is carried through ingest over the routes, dispatch by the real processor on
// a fake gateway, a failing dispatch, and the purge. The test then proves the
// string is absent from every console line, every trace event, every error or
// control response and the purge's tombstone - while the owner's own stream
// still holds it, so the plant is known to have reached storage.
import { randomUUID } from "node:crypto";
import type { PlatformContext } from "@omnitech/platform-contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type Fixture,
  type Person,
  PNG_BYTES,
  startFixture,
} from "./live-session-fixture.js";
import {
  buildProcessor,
  collectTraces,
  createFakeGateway,
  settle,
} from "./processor-fixture.js";
import { ActiveSessionRepository } from "./repository.js";
import { createSessionRoutes } from "./routes.js";
import { purgeSession } from "./session-purge.js";
import { RECRUITER_SCREEN } from "./session-replay-fixtures.js";

const CANARY = `canary-${randomUUID()}-secret`;

let fx: Fixture;
let slug = "";
let acting: Person | null = null;
const base = () => `http://studio.test/api/interview/t/${slug}/sessions`;

beforeAll(async () => {
  fx = await startFixture();
  slug = String(
    (
      await fx.owner.query("SELECT slug FROM platform.tenants WHERE id=$1", [
        fx.tenantA,
      ])
    ).rows[0].slug,
  );
  await fx.owner.query(
    `INSERT INTO platform.product_installations(tenant_id,product_id,display_name,description,icon,configuration)
     VALUES($1,'omnitech.interview','Interview','Interview','sparkles','{}')`,
    [fx.tenantA],
  );
}, 120_000);
afterAll(() => fx?.stop());

async function resolveContext(requested: string) {
  if (!acting || requested !== slug) return null;
  return {
    user: {
      id: acting.id,
      email: "x@live.test",
      displayName: "x",
      avatarUrl: null,
    },
    tenant: { id: fx.tenantA, slug, name: "T" },
    membership: { tenantId: fx.tenantA, userId: acting.id, role: "member" },
    preferences: { theme: "system", locale: "en" },
    permissions: ["interview.read", "interview.write"],
    products: [{ productId: "omnitech.interview", enabled: true }],
  } as unknown as PlatformContext;
}

describe("the canary never leaves the owner's own reads", () => {
  it("is absent from logs, traces, errors, control responses and the tombstone", async () => {
    // Everything the process might emit.
    const logged: unknown[][] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, method).mockImplementation((...args) => {
        logged.push(args);
      });
    const traces = collectTraces();
    // Responses a caller other than the owner reading their own stream sees.
    const responses: string[] = [];
    const record = async (response: Response) => {
      responses.push(`${response.status} ${await response.clone().text()}`);
      return response;
    };

    const repo = new ActiveSessionRepository(fx.member);
    const app = createSessionRoutes({ database: fx.member, resolveContext });
    const person = await fx.provision(fx.tenantA, "canary");
    acting = person;
    const send = (path: string, body: unknown, method = "POST") =>
      app.request(`${base()}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });

    // Error paths on the user routes: the canary in a malformed body, in an
    // unknown field and in an id.
    await record(await send("", `{"captureSources": ["${CANARY}"`));
    await record(
      await send("", {
        processingPolicy: CANARY,
        captureSources: [CANARY],
        [CANARY]: CANARY,
      }),
    );
    await record(await send(`/${CANARY}/control`, { action: CANARY }));
    await record(await app.request(`${base()}/${CANARY}`));

    const started = await send("", {
      processingPolicy: "permitted-remote",
      captureSources: ["microphone", "application-audio"],
    });
    expect(started.status).toBe(201);
    const startedBody = (await started.json()) as {
      session: { id: string };
      credential: { value: string };
    };
    const sessionId = startedBody.session.id;
    const credential = startedBody.credential.value;
    const scope = { tenantId: fx.tenantA, actorId: person.id };

    // Ingest over the route with no user session: the final transcript that
    // opens the first question carries the canary, so it is dispatched too.
    acting = null;
    const ingest = (body: unknown, headers: Record<string, string> = {}) =>
      app.request(`${base()}/ingest`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential}`,
          ...(body instanceof FormData
            ? {}
            : { "content-type": "application/json" }),
          ...headers,
        },
        body: body instanceof FormData ? body : JSON.stringify(body),
      });
    const sequences: Record<string, number> = {};
    for (const segment of RECRUITER_SCREEN[0]?.segments ?? []) {
      const source =
        segment.role === "interviewer" ? "application-audio" : "microphone";
      sequences[source] = (sequences[source] ?? 0) + 1;
      const last = segment === RECRUITER_SCREEN[0]?.segments.at(-1);
      const response = await record(
        await ingest({
          version: 1,
          kind: "transcript.final",
          sourceId: source,
          eventId: segment.eventId,
          occurredAt: "2026-10-03T10:00:00.000Z",
          sequence: sequences[source],
          content: {
            speaker: segment.role === "interviewer" ? "speaker-1" : "speaker-2",
            text: last ? `${segment.text} ${CANARY}` : segment.text,
            startMs: segment.startMs,
            endMs: segment.endMs,
          },
        }),
      );
      expect(response.status).toBe(200);
    }
    // Screenshot metadata carrying the canary, as multipart with its pixels.
    const form = new FormData();
    form.set(
      "envelope",
      JSON.stringify({
        version: 1,
        kind: "screen.snapshot",
        sourceId: "screen",
        eventId: "canary-shot",
        occurredAt: "2026-10-03T10:00:00.000Z",
        sequence: 1,
        content: {
          payloadRef: CANARY,
          mediaType: "image/png",
          byteLength: PNG_BYTES.byteLength,
          windowLabel: CANARY,
        },
      }),
    );
    form.set("payload", new File([PNG_BYTES], "p.png", { type: "image/png" }));
    // (The screen source was not permitted at start: a refusal, or accepted;
    // either way nothing may echo the label.)
    await record(await ingest(form));

    // Ingest error paths: the canary in an unknown field, as the event kind,
    // as a malformed credential and in the query string.
    await record(
      await ingest({
        version: 1,
        kind: CANARY,
        sourceId: "microphone",
        eventId: "e-bad",
        [CANARY]: CANARY,
      }),
    );
    await record(await ingest(`{"text": "${CANARY}`));
    await record(await ingest({}, { authorization: `Bearer ${CANARY}` }));
    await record(
      await app.request(`${base()}/ingest?credential=${CANARY}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    await record(
      await ingest(JSON.stringify(`${CANARY}${"x".repeat(40 * 1024)}`)),
    );

    // Dispatch: the real processor on a fake gateway. The gateway request
    // holds the question (its job), the processor's traces must not.
    const gateway = createFakeGateway();
    const processor = buildProcessor(fx, {
      workerId: "worker-canary",
      gateway,
      trace: traces,
    });
    await settle(processor);
    expect(gateway.requests.length).toBeGreaterThan(0);
    expect(JSON.stringify(gateway.requests)).toContain(CANARY);
    await processor.close();

    // The plant reached storage: the owner's own stream holds it.
    acting = person;
    const stream = await app.request(`${base()}/${sessionId}/stream`);
    expect(await stream.text()).toContain(CANARY);

    // Failure: a gateway that throws the canary, on a second session.
    const second = await fx.provision(fx.tenantA, "canary-failure");
    const secondStart = await repo.startSession(
      { tenantId: fx.tenantA, actorId: second.id },
      {
        processingPolicy: "permitted-remote",
        captureSources: ["microphone", "application-audio"],
      },
    );
    const failing = createFakeGateway({
      fail: () => new Error(`gateway failed on ${CANARY}`),
    });
    const failingProcessor = buildProcessor(fx, {
      workerId: "worker-canary-failure",
      gateway: failing,
      trace: traces,
      options: { maxAttempts: 2 },
    });
    acting = null;
    const failingCredential = secondStart.credential.value;
    const failingSequences: Record<string, number> = {};
    for (const segment of RECRUITER_SCREEN[0]?.segments ?? []) {
      const source =
        segment.role === "interviewer" ? "application-audio" : "microphone";
      failingSequences[source] = (failingSequences[source] ?? 0) + 1;
      await app.request(`${base()}/ingest`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${failingCredential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          version: 1,
          kind: "transcript.final",
          sourceId: source,
          eventId: segment.eventId,
          occurredAt: "2026-10-03T10:00:00.000Z",
          sequence: failingSequences[source],
          content: {
            speaker: "speaker-1",
            text: `${segment.text} ${CANARY}`,
            startMs: segment.startMs,
            endMs: segment.endMs,
          },
        }),
      });
    }
    await settle(failingProcessor, 12);
    expect(failing.requests.length).toBeGreaterThan(0);
    await failingProcessor.close();
    const failedStates = (
      await repo.listActions(
        { tenantId: fx.tenantA, actorId: second.id },
        secondStart.session.id,
      )
    ).map((action) => action.dispatchStatus);
    expect(failedStates).toContain("failed");
    // A failed action keeps no error text.
    expect(
      JSON.stringify(
        await repo.listActions(
          { tenantId: fx.tenantA, actorId: second.id },
          secondStart.session.id,
        ),
      ),
    ).not.toContain("gateway failed");

    // Control, renewal and the owner's delete, then the purge.
    acting = person;
    const control = await record(
      await send(`/${sessionId}/control`, {
        version: 1,
        kind: "session.control",
        action: "end",
      }),
    );
    expect(control.status).toBe(200);
    await record(await send(`/${sessionId}/credential`, {}));
    await record(await send(`/${sessionId}`, "", "DELETE"));
    const purged = await purgeSession(
      fx.member,
      { tenantId: fx.tenantA, ownerUserId: person.id, sessionId },
      { trigger: "owner-delete", waitMs: 0, pollMs: 1, sleep: async () => {} },
    );
    responses.push(JSON.stringify(purged));
    expect(scope.actorId).toBe(person.id);
    const tombstone = await fx.owner.query(
      "SELECT row_to_json(s)::text AS row FROM interview.active_sessions s WHERE id=$1",
      [sessionId],
    );
    responses.push(String(tombstone.rows[0].row));
    const left = await fx.owner.query(
      "SELECT count(*)::int AS n FROM interview.session_observations WHERE session_id=$1",
      [sessionId],
    );
    expect(left.rows[0].n).toBe(0);
    // The purge removed the screenshot artifacts, whose metadata held the label.
    const artifacts = await fx.owner.query(
      "SELECT count(*)::int AS n FROM platform.artifacts WHERE metadata::text LIKE $1",
      [`%${CANARY}%`],
    );
    expect(artifacts.rows[0].n).toBe(0);

    // The assertion that matters: nothing captured holds the canary or a
    // credential.
    expect(traces.events.length).toBeGreaterThan(0);
    const everything = JSON.stringify({
      logged,
      traces: traces.events,
      responses,
    });
    expect(everything).not.toContain(CANARY);
    expect(everything).not.toContain(credential);
    expect(everything).not.toContain(failingCredential);
    expect(everything).not.toContain("canary-secret");
    // Console output stayed silent on every path, expected or not.
    expect(logged).toEqual([]);
  });
});
