// Hardening case 5 (PB-0002 slice 3): a same-tenant member who is NOT the
// owner reaches nothing of another member's Active Session on any read path.
// Owner A's session is built through the real routes with a fixture companion
// (transcripts, a screenshot, a capability report), the real processor and a
// private job; member B and member C then try every path as themselves. Each
// negative has a positive control: A reads the same thing and gets content.
import { sql } from "drizzle-orm";
import * as fixture from "@omnitech/capture-companion/fixture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PNG_BYTES } from "../live-session-fixture.js";
import {
  buildProcessor,
  createFakeGateway,
  insertSessionJob,
  seedBriefingDraft,
  seedMatrixProfile,
  settle,
} from "../processor-fixture.js";
import { ActiveSessionRepository } from "../repository.js";
import { inOwnerScope, rowsOf } from "../scope.js";
import { loadSessionContext } from "../session-context.js";
import { getSessionContext, getSessionJob } from "../session-reads.js";
import { RECRUITER_SCREEN } from "../session-replay-fixtures.js";
import { type Started, startWorld, type World } from "./world.js";

let world: World;
let repo: ActiveSessionRepository;
let a: Started;
let b: Started;
let artifactId = "";
let jobId = "";
let links: {
  interviewId: string;
  candidacyId: string;
  profile: { id: string };
  workspaceDraft: { workspaceId: string; artifactId: string };
};

const UNKNOWN = "00000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  world = await startWorld(fixture);
  const { fx } = world;
  repo = new ActiveSessionRepository(fx.member);

  // Owner A: a real profile revision, a briefing draft, an interview, and a
  // session that pins and links all of them.
  const person = await fx.provision(fx.tenantA, "owner-a");
  const profile = await seedMatrixProfile(fx, fx.tenantA, person.id);
  const workspaceDraft = await seedBriefingDraft(
    fx,
    fx.tenantA,
    person.id,
    profile,
    { employerNotes: "Employer notes that belong to owner A only." },
  );
  links = {
    interviewId: person.interview,
    candidacyId: person.candidacy,
    profile: { id: profile.id },
    workspaceDraft,
  };
  a = await world.begin(person, {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "application-audio", "screen"],
    ...links,
  });
  const run = world.companion(a, {
    sources: ["microphone", "application-audio", "screen"],
  });
  await run.open();
  for (const segment of RECRUITER_SCREEN[0]?.segments ?? [])
    await run.companion.observeTranscript({
      eventId: segment.eventId,
      source:
        segment.role === "interviewer" ? "application-audio" : "microphone",
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
    });
  await run.companion.observeScreenshot({
    payload: PNG_BYTES,
    mediaType: "image/png",
    windowLabel: "Owner A's private window",
  });
  const gateway = createFakeGateway();
  const processor = buildProcessor(fx, { workerId: "worker-cross", gateway });
  await settle(processor);
  await processor.close();
  jobId = await insertSessionJob(
    fx,
    { person, sessionId: a.id },
    fx.tenantA,
    "succeeded",
  );
  artifactId = String(
    (await world.page(a)).observations.find((o) => o.screenshotArtifactId)
      ?.screenshotArtifactId,
  );

  // Member B has a session of their own, so lists and current are non-empty
  // and must hold only B's.
  b = await world.begin("member-b");
}, 120_000);
afterAll(() => world?.stop());

// What a read answers: status and body, so a foreign session can be compared
// with an unknown one.
async function answer(response: Response) {
  return { status: response.status, body: await response.text() };
}
const asB = () => world.as(b.person);

describe("every read path answers a same-tenant other user as an unknown session", () => {
  it("has real content for the owner to be denied (positive controls)", async () => {
    world.as(a.person);
    const detail = await world.get(`/${a.id}`);
    expect(detail.status).toBe(200);
    const page = await world.page(a);
    expect(page.observations.length).toBeGreaterThan(3);
    expect(page.actions.length).toBeGreaterThan(0);
    const download = await world.get(`/${a.id}/screenshots/${artifactId}`);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PNG_BYTES);
    const capability = (await (
      await world.get("/companion-capability")
    ).json()) as { capability: { speech: { locale: string } } | null };
    expect(capability.capability?.speech.locale).toBe("en-GB");
    expect(
      (await getSessionContext(world.fx.member, a.scope, a.id))?.profile,
    ).not.toBeNull();
    expect(
      await getSessionJob(world.fx.member, repo.jobs, a.scope, a.id, jobId),
    ).toBeDefined();
  });

  it("stream, status and detail", async () => {
    asB();
    for (const path of [``, `/stream`, `/stream?afterSequence=0&limit=500`]) {
      const foreign = await answer(await world.get(`/${a.id}${path}`));
      const unknown = await answer(await world.get(`/${UNKNOWN}${path}`));
      expect(foreign, path).toEqual(unknown);
      expect(foreign.status).toBe(404);
      // Content-free: nothing of A's session is in the refusal.
      expect(foreign.body).not.toContain("Employer notes");
      expect(foreign.body).not.toContain(a.id);
    }
    // An action cursor taken from A's own page buys nothing either.
    world.as(a.person);
    const cursor = (await world.page(a)).nextActionCursor;
    asB();
    const withCursor = await answer(
      await world.get(`/${a.id}/stream?actionCursor=${cursor}`),
    );
    expect(withCursor.status).toBe(404);
  });

  it("list and current show only the caller's own sessions", async () => {
    asB();
    const listed = (await (await world.get("")).json()) as {
      sessions: Array<{ id: string }>;
    };
    expect(listed.sessions.map((entry) => entry.id)).toEqual([b.id]);
    const current = (await (await world.get("/current")).json()) as {
      session: { id: string };
    };
    expect(current.session.id).toBe(b.id);
    expect(JSON.stringify(listed)).not.toContain(a.id);
  });

  it("action reads and the stream's action cursor", async () => {
    asB();
    // B's own stream never carries an action of A's session.
    const own = await world.page(b);
    expect(own.actions).toEqual([]);
    // Straight SQL as B under the real role sees none of A's rows at all.
    const visible = await inOwnerScope(
      world.fx.member,
      b.scope,
      async (tx) => ({
        actions: await rowsOf(tx, sql`SELECT 1 FROM interview.session_actions`),
        observations: await rowsOf(
          tx,
          sql`SELECT 1 FROM interview.session_observations`,
        ),
        sessions: await rowsOf<{ id: string }>(
          tx,
          sql`SELECT id FROM interview.active_sessions`,
        ),
      }),
    );
    expect(visible.actions).toEqual([]);
    expect(visible.observations.length).toBe(0);
    expect(visible.sessions.map((row) => row.id)).toEqual([b.id]);
    // The repository read, in B's scope, for A's session.
    for (const read of [
      () => repo.listActions(b.scope, a.id),
      () => repo.listObservations(b.scope, a.id, {}),
    ])
      await expect(read()).rejects.toMatchObject({ code: "not_found" });
    expect(await repo.getSession(b.scope, a.id)).toBeNull();
  });

  it("downloads and screenshot artifacts", async () => {
    asB();
    const foreign = await answer(
      await world.get(`/${a.id}/screenshots/${artifactId}`),
    );
    const unknown = await answer(
      await world.get(`/${UNKNOWN}/screenshots/${UNKNOWN}`),
    );
    expect(foreign).toEqual(unknown);
    expect(foreign.status).toBe(404);
    // B's own session id with A's artifact id is no better.
    const mixed = await answer(
      await world.get(`/${b.id}/screenshots/${artifactId}`),
    );
    expect(mixed.status).toBe(404);
    expect(mixed.body).not.toContain("PNG");
  });

  it("controls, credential, policy, retention and delete", async () => {
    asB();
    const attempts: Array<[string, unknown, string]> = [
      [
        `/${a.id}/control`,
        { version: 1, kind: "session.control", action: "end" },
        "POST",
      ],
      [`/${a.id}/credential`, {}, "POST"],
      [`/${a.id}/credential`, undefined, "DELETE"],
      [`/${a.id}/policy`, { processingPolicy: "device-only" }, "POST"],
      [`/${a.id}/retention`, { retention: "delete-at-end" }, "POST"],
      [`/${a.id}`, undefined, "DELETE"],
    ];
    for (const [path, body, method] of attempts) {
      const foreign = await answer(await world.send(path, body, method));
      const unknown = await answer(
        await world.send(path.replace(a.id, UNKNOWN), body, method),
      );
      expect(foreign, `${method} ${path}`).toEqual(unknown);
      expect(foreign.status).toBe(404);
    }
    // A's session is untouched: still active, credential still working.
    world.as(a.person);
    const still = (await (await world.get(`/${a.id}`)).json()) as {
      session: { status: string; credentialRevoked?: boolean };
    };
    expect(still.session.status).toBe("active");
    expect(still.session.credentialRevoked).not.toBe(true);
  });

  it("context assembly inputs: profile revision, briefing draft and interview", async () => {
    expect(await getSessionContext(world.fx.member, b.scope, a.id)).toBeNull();
    const foreign = await loadSessionContext(
      world.fx.member,
      b.scope,
      a.id,
    ).then(
      () => "loaded",
      (error: { code?: string }) => error.code ?? "error",
    );
    const unknown = await loadSessionContext(
      world.fx.member,
      b.scope,
      UNKNOWN,
    ).then(
      () => "loaded",
      (error: { code?: string }) => error.code ?? "error",
    );
    expect(foreign).toBe(unknown);
    expect(foreign).not.toBe("loaded");
    // The linked rows are invisible to B under the real role, whatever the
    // session says: A's profile revision and briefing draft. (Interviews and candidacies are
    // tenant-visible by design; the start-time link check is what refuses them,
    // see the linked-resource case below.)
    const visible = await inOwnerScope(
      world.fx.member,
      b.scope,
      async (tx) => ({
        profiles: await rowsOf(
          tx,
          sql`SELECT 1 FROM interview.candidate_profile_revisions WHERE id = ${links.profile.id}`,
        ),
        drafts: await rowsOf(
          tx,
          sql`SELECT 1 FROM interview.assistant_drafts WHERE workspace_id = ${links.workspaceDraft.workspaceId}`,
        ),
      }),
    );
    expect(visible.profiles).toEqual([]);
    expect(visible.drafts).toEqual([]);
  });

  it("job results", async () => {
    expect(
      await getSessionJob(world.fx.member, repo.jobs, b.scope, a.id, jobId),
    ).toBeUndefined();
    // Naming A's job through B's own session does not reach it either.
    expect(
      await getSessionJob(world.fx.member, repo.jobs, b.scope, b.id, jobId),
    ).toBeUndefined();
    expect(
      await repo.jobs.get(world.fx.tenantA, b.person.id, jobId),
    ).toBeUndefined();
    // The row exists: A's own scope reads it.
    expect(
      await repo.jobs.get(world.fx.tenantA, a.person.id, jobId),
    ).toBeDefined();
  });

  it("artifact discovery under the real row-security roles", async () => {
    const seen = async (scope: Started["scope"]) =>
      inOwnerScope(world.fx.member, scope, async (tx) => ({
        artifacts: await rowsOf(
          tx,
          sql`SELECT id FROM platform.artifacts WHERE artifact_type = 'interview.session-screenshot'`,
        ),
        byId: await rowsOf(
          tx,
          sql`SELECT id FROM platform.artifacts WHERE id = ${artifactId}::uuid`,
        ),
        payloads: await rowsOf(
          tx,
          sql`SELECT artifact_id FROM platform.artifact_payloads WHERE artifact_id = ${artifactId}::uuid`,
        ),
        joined: await rowsOf(
          tx,
          sql`SELECT a.id FROM platform.artifacts a JOIN platform.artifact_payloads p ON p.artifact_id = a.id WHERE a.metadata->>'session_id' = ${a.id}`,
        ),
      }));
    const asOwner = await seen(a.scope);
    expect(asOwner.artifacts).toHaveLength(1);
    expect(asOwner.payloads).toHaveLength(1);
    const asOther = await seen(b.scope);
    expect(asOther).toEqual({
      artifacts: [],
      byId: [],
      payloads: [],
      joined: [],
    });
  });

  it("linked-resource use: another member's interview, candidacy, profile or draft is refused at start", async () => {
    const c = await world.fx.provision(world.fx.tenantA, "member-c");
    world.as(c);
    const start = (extra: Record<string, unknown>) =>
      world.send("", {
        processingPolicy: "permitted-remote",
        captureSources: ["microphone"],
        ...extra,
      });
    const unknownLinks = {
      interviewId: UNKNOWN,
      candidacyId: UNKNOWN,
      profile: { id: "no-such-profile" },
      workspaceDraft: { workspaceId: "no-ws", artifactId: "no-art" },
    } as const;
    for (const key of [
      "interviewId",
      "candidacyId",
      "profile",
      "workspaceDraft",
    ] as const) {
      const foreign = await answer(await start({ [key]: links[key] }));
      const unknown = await answer(await start({ [key]: unknownLinks[key] }));
      expect(foreign.status, key).toBeGreaterThanOrEqual(400);
      expect(foreign.status, key).toBeLessThan(500);
      expect(foreign, key).toEqual(unknown);
    }
    // No session was created for C by any attempt.
    expect(
      (
        await world.fx.owner.query(
          "SELECT count(*)::int AS n FROM interview.active_sessions WHERE owner_user_id=$1",
          [c.id],
        )
      ).rows[0].n,
    ).toBe(0);

    // Despite the tenant-scoped foreign keys (which A's rows satisfy for any
    // member of the tenant), a session row written directly as C under the
    // real role cannot link A's interview or candidacy.
    const insertLinked = (linked: Record<string, string>) =>
      inOwnerScope(
        world.fx.member,
        { tenantId: world.fx.tenantA, actorId: c.id },
        async (tx) => {
          try {
            await tx.execute(
              sql`INSERT INTO interview.active_sessions (tenant_id, owner_user_id, status, retention_mode, processing_policy, sources, expires_at, ${sql.raw(Object.keys(linked).join(", "))})
                  VALUES (${world.fx.tenantA}::uuid, ${c.id}::uuid, 'created', 'delete_at_end', 'permitted_remote', '{"captureSources":["microphone"],"liveAssistance":true}'::jsonb, now() + interval '1 hour', ${sql.join(
                    Object.values(linked).map((value) => sql`${value}::uuid`),
                    sql`, `,
                  )})`,
            );
            return "inserted";
          } catch (error) {
            // The database's own code, so a refusal for any OTHER reason (a
            // missing column, a bad literal) cannot pass for the link check.
            const code = (error as { cause?: { code?: string } }).cause?.code;
            return `refused:${code}`;
          }
        },
      );
    for (const column of ["interview_id", "candidacy_id"] as const) {
      const value =
        column === "interview_id" ? links.interviewId : links.candidacyId;
      expect(await insertLinked({ [column]: value }), column).toBe(
        "refused:23503",
      );
    }
    // Positive control: the same statement with C's own interview is accepted.
    expect(
      await insertLinked({
        candidacy_id: c.candidacy,
        interview_id: c.interview,
      }),
    ).toBe("inserted");
  });

  it("the companion capability route", async () => {
    asB();
    const none = (await (await world.get("/companion-capability")).json()) as {
      capability: unknown;
    };
    expect(none.capability).toBeNull();
    const body = await (await world.get("/companion-capability")).text();
    expect(body).not.toContain("en-GB");
  });
});
