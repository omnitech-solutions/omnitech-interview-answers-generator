// The interview brief, end to end on a real PostgreSQL (migrated to head, the
// application's own NOSUPERUSER NOBYPASSRLS role) and through the documents
// API's real guard: an application with two stages, their people, notes,
// transcripts and outcome, what the employer said and the research, written
// and read back as its owner, as another member, as a read-only member and
// from another workspace; then the context pack built from what was stored,
// on a real AI engine with no model behind it. Every name and figure here is
// invented.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAiEngine } from "@omnitech/ai-engine";
import {
  createPlatformDatabase,
  type PlatformDatabase,
  withTenant,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import {
  CARRIED_RESEARCH_ID,
  INTERVIEW_BRIEF_BOUNDS,
  type InterviewBrief,
  interviewBriefSchema,
  type StageTranscript,
  stageRecordingsResponseSchema,
  stageTranscriptDetailSchema,
} from "@omnitech/interview-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BRIEF_SOURCE_KINDS,
  type BriefSource,
  briefSources,
  remoteSources,
  sourceMayLeaveDevice,
} from "../context-pack/brief-sources";
import { contextOf, EXECUTION } from "../context-pack/fixture";
import { prepareContextPack, sessionSources } from "../context-pack/pack";
import { KINDS } from "../context-pack/recipe";
import { prepareStagePack } from "../context-pack/stage";
import {
  employerSaidEntries,
  interviewTranscripts,
  researchDocuments,
} from "../db/brief";
import { createDocumentsApi, resolveDocumentsScope } from "../documents/api";
import { type BriefMaterial, readBriefMaterial } from "./repository";

let pg: DisposablePostgres;
let database: PlatformDatabase;
let recordings: string;
const ids = {
  tenant: "",
  elsewhere: "",
  owner: "",
  other: "",
  outsider: "",
};
const engine = createAiEngine({ profiles: [], providers: {} });

const url = "http://studio.test/api/interview/documents";
function context(
  tenant: { id: string; slug: string },
  actorId: string,
  permissions: string[],
): PlatformContext {
  return {
    user: {
      id: actorId,
      email: `${actorId}@example.invalid`,
      displayName: "Member",
      avatarUrl: null,
    },
    tenant: { ...tenant, name: tenant.slug },
    membership: { tenantId: tenant.id, userId: actorId, role: "member" },
    preferences: { theme: "system", locale: "en" },
    permissions,
    products: [
      {
        productId: "omnitech.interview",
        name: "Interview",
        description: "",
        icon: "sparkles",
        enabled: true,
        routePrefix: "",
        navigation: { group: "", order: 0, hidden: false, routes: {} },
        featureFlags: {},
        settings: {},
        revision: 1,
      },
    ],
  } as PlatformContext;
}
// The API as one member of one workspace calls it.
function as(
  actorId: string,
  options: { permissions?: string[]; slug?: string; tenantId?: string } = {},
) {
  const slug = options.slug ?? "local";
  const api = createDocumentsApi({
    database,
    engine,
    recordingsDirectory: recordings,
    resolveScope: async (request) =>
      resolveDocumentsScope(
        context(
          { id: options.tenantId ?? ids.tenant, slug },
          actorId,
          options.permissions ?? [
            "interview.read",
            "interview.documents.write",
          ],
        ),
        request.headers.get("x-omnitech-tenant") ?? "",
        request.method,
      ),
  });
  const headers = { "x-omnitech-tenant": slug };
  const send = (method: string, path: string, body?: unknown) =>
    api.request(`${url}${path}`, {
      method,
      headers:
        body === undefined
          ? headers
          : { ...headers, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    get: (path: string) => send("GET", path),
    post: (path: string, body: unknown = {}) => send("POST", path, body),
    patch: (path: string, body: unknown) => send("PATCH", path, body),
    put: (path: string, body: unknown) => send("PUT", path, body),
    remove: (path: string) => send("DELETE", path),
    upload: (path: string, form: FormData) =>
      api.request(`${url}${path}`, { method: "POST", headers, body: form }),
    raw: (path: string, init: RequestInit) =>
      api.request(`${url}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers as Record<string, string>) },
      }),
  };
}
const codeOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;
const briefOf = async (response: Response): Promise<InterviewBrief> =>
  interviewBriefSchema.parse(await response.json());

const one = async (sql: string, values: unknown[] = []) =>
  String((await pg.owner.query<{ id: string }>(sql, values)).rows[0]?.id);

beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`GRANT USAGE ON SCHEMA platform, interview TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, interview TO fixture_member;`);
  ids.tenant = await one(
    "INSERT INTO platform.tenants(slug,name) VALUES ('local','Local') RETURNING id",
  );
  ids.elsewhere = await one(
    "INSERT INTO platform.tenants(slug,name) VALUES ('elsewhere','Elsewhere') RETURNING id",
  );
  const user = (name: string) =>
    one(
      "INSERT INTO platform.users(email,display_name) VALUES ($1,$2) RETURNING id",
      [`${name}@example.invalid`, name],
    );
  ids.owner = await user("owner");
  ids.other = await user("other");
  ids.outsider = await user("outsider");
  for (const [tenant, member] of [
    [ids.tenant, ids.owner],
    [ids.tenant, ids.other],
    [ids.elsewhere, ids.outsider],
  ])
    await pg.owner.query(
      "INSERT INTO platform.tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
      [tenant, member],
    );
  database = createPlatformDatabase(pg.memberUrl);
  recordings = await mkdtemp(join(tmpdir(), "brief-recordings-"));
}, 60_000);
afterAll(async () => {
  await database?.close();
  await pg?.stop();
  if (recordings) await rm(recordings, { recursive: true, force: true });
});

// A recorder's file as the Studio writes one (transcript-recording.ts).
const RECORDED = [
  "10:39:54 --> 10:40:09",
  "Interviewer: how do you decide when a feature should be a service of its own",
  "",
  "10:40:12 --> 10:40:30",
  "Me: by who owns the data and how often it ships",
  "",
  "10:40:31 --> 10:40:52",
  "Me: at Harbourline the berth scheduler shipped daily on its own",
  "",
].join("\n");
const PASTED = [
  "Dana: Tell me about the Quayside Freight reporting service.",
  "Me: I built it on NestJS for the dock invoices.",
  "Dana: What would you change about it now?",
].join("\n");
const VTT = [
  "WEBVTT",
  "",
  "1",
  "00:00:01.000 --> 00:00:04.000",
  "<v Priya>Walk me through the design round.",
  "",
  "2",
  "00:00:05.000 --> 00:00:09.500",
  "<v Me>I start from the invariants.",
  "",
].join("\n");

// The application every test below works on, made through the API.
const made = {
  candidacy: "",
  first: "",
  second: "",
  recorded: "",
  pasted: "",
  recordingFile: "",
  strangerFile: "",
};
const path = () => `/candidacies/${made.candidacy}`;
const stageIn = (brief: InterviewBrief, id: string) => {
  const stage = brief.stages.find((each) => each.id === id);
  if (!stage) throw new Error("stage missing");
  return stage;
};

describe("an application with two stages, made through the API", () => {
  it("creates the application with its first stage, then a second", async () => {
    const mine = as(ids.owner);
    const created = await mine.post("/candidacies", {
      companyName: "Larkspur Analytics",
      title: "Principal Engineer",
      jobDescription: "Rebuild the forecasting pipeline.",
      interview: { kind: "hiring_manager", label: "Hiring manager" },
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      candidacyId: string;
      interviewId: string;
    };
    made.candidacy = body.candidacyId;
    made.first = body.interviewId;

    const added = await mine.post(`${path()}/stages`, {
      kind: "technical",
      label: "Technical",
    });
    expect(added.status).toBe(201);
    const brief = await briefOf(added);
    expect(
      brief.stages.map(({ ordinal, kind, label }) => [ordinal, kind, label]),
    ).toEqual([
      [1, "hiring_manager", "Hiring manager"],
      [2, "technical", "Technical"],
    ]);
    made.second = brief.stages[1]?.id ?? "";
    // A stage starts with nothing of its own.
    expect(brief.stages[1]).toMatchObject({
      notes: null,
      offeredNotes: null,
      outcome: null,
      nextSteps: null,
      people: [],
      transcripts: [],
      scheduledAt: null,
      durationMinutes: null,
      format: null,
      status: "scheduled",
    });
    expect(brief).toMatchObject({
      companyName: "Larkspur Analytics",
      title: "Principal Engineer",
      applicationNotes: null,
      employerSaid: [],
      research: [],
    });
  });

  it("gives each stage its people, when, minutes, format, notes and outcome", async () => {
    const mine = as(ids.owner);
    const first = await mine.patch(`${path()}/stages/${made.first}`, {
      scheduledAt: "2026-11-03T17:30:00.000Z",
      durationMinutes: 60,
      format: "video",
      status: "completed",
      notes:
        "NestJS: the Quayside Freight reporting service, 42000 invoices per day.\n- Why Larkspur: tide forecasts for 300 marinas.",
      outcome: "Went well; she pressed on data ownership.",
      nextSteps: "A technical round within two weeks.",
      people: [
        {
          name: "Dana Whitlow",
          title: "Head of Platform",
          role: "hiring_manager",
        },
        { name: "Sam Reyes", role: "recruiter" },
      ],
    });
    expect(first.status).toBe(200);
    const second = await mine.patch(`${path()}/stages/${made.second}`, {
      durationMinutes: 120,
      format: "onsite",
      notes:
        "Scheduler: lead with the Harbourline berth scheduler rewrite in Go.\nSystem design: start from the invariants.",
      people: [{ name: "Priya Nair", title: "Staff Engineer" }],
    });
    const brief = await briefOf(second);
    expect(stageIn(brief, made.first)).toMatchObject({
      scheduledAt: "2026-11-03T17:30:00.000Z",
      durationMinutes: 60,
      format: "video",
      status: "completed",
      outcome: "Went well; she pressed on data ownership.",
      nextSteps: "A technical round within two weeks.",
    });
    expect(
      stageIn(brief, made.first).people.map(({ name, title, role }) => [
        name,
        title,
        role,
      ]),
    ).toEqual([
      ["Dana Whitlow", "Head of Platform", "hiring_manager"],
      ["Sam Reyes", null, "recruiter"],
    ]);
    expect(stageIn(brief, made.second).people).toMatchObject([
      { name: "Priya Nair", title: "Staff Engineer", role: "interviewer" },
    ]);
    expect(stageIn(brief, made.second).notes).toContain("berth scheduler");
    // The people are the employer's `people`, tied by `interview_participants`.
    const stored = await pg.owner.query<{ full_name: string; role: string }>(
      `SELECT p.full_name, ip.role FROM interview.interview_participants ip
         JOIN interview.people p ON p.id = ip.person_id
        WHERE ip.interview_id = $1 ORDER BY p.full_name`,
      [made.first],
    );
    expect(stored.rows).toEqual([
      { full_name: "Dana Whitlow", role: "hiring_manager" },
      { full_name: "Sam Reyes", role: "recruiter" },
    ]);
  });

  it("attaches two transcripts to the first stage: one pasted, one recorded device-only", async () => {
    const mine = as(ids.owner);
    const pasted = await mine.post(
      `${path()}/stages/${made.first}/transcripts`,
      {
        title: "Call with Dana",
        text: PASTED,
        occurredAt: "2026-11-03T17:30:00.000Z",
        capturePolicy: "permitted-remote",
      },
    );
    expect(pasted.status).toBe(201);
    const first = (await pasted.json()) as { transcript: StageTranscript };
    made.pasted = first.transcript.id;
    expect(first.transcript).toMatchObject({
      origin: "pasted",
      capturePolicy: "permitted-remote",
      sendable: true,
      chars: PASTED.length,
      turns: 3,
      stageId: made.first,
    });

    // The Studio recorded a device-only session of the owner's, and one of
    // the other member's.
    const session = (owner: string, policy: string) =>
      one(
        `INSERT INTO interview.active_sessions(tenant_id,owner_user_id,processing_policy,expires_at)
         VALUES($1,$2,$3,now()+interval '1 hour') RETURNING id`,
        [ids.tenant, owner, policy],
      );
    const own = await session(ids.owner, "device_only");
    const theirs = await session(ids.other, "permitted_remote");
    // Both are over: a recording outlives its session.
    await pg.owner.query(
      "UPDATE interview.active_sessions SET status='ended' WHERE id = ANY($1)",
      [[own, theirs]],
    );
    made.recordingFile = `2026-11-03T17-39-54-120-${own.slice(0, 8)}.txt`;
    made.strangerFile = `2026-11-03T18-00-00-000-${theirs.slice(0, 8)}.txt`;
    await writeFile(join(recordings, made.recordingFile), RECORDED);
    await writeFile(join(recordings, made.strangerFile), RECORDED);
    await writeFile(join(recordings, "notes.txt"), "not a recording");

    const listed = stageRecordingsResponseSchema.parse(
      await (await mine.get(`${path()}/recordings`)).json(),
    );
    // Only the member's own recording, with its session's policy.
    expect(listed.recordings).toEqual([
      {
        file: made.recordingFile,
        startedAt: "2026-11-03T17:39:54.120Z",
        bytes: RECORDED.length,
        capturePolicy: "device-only",
        attached: false,
      },
    ]);
    const attached = await mine.post(
      `${path()}/stages/${made.first}/transcripts/recordings`,
      { file: made.recordingFile },
    );
    expect(attached.status).toBe(201);
    const second = (await attached.json()) as { transcript: StageTranscript };
    made.recorded = second.transcript.id;
    expect(second.transcript).toMatchObject({
      origin: "recorded",
      originName: made.recordingFile,
      capturePolicy: "device-only",
      sendable: false,
      occurredAt: "2026-11-03T17:39:54.120Z",
      // Two fragments of one speaker are one turn.
      turns: 2,
    });
    // Attaching the same recording again is the transcript already there.
    const again = await mine.post(
      `${path()}/stages/${made.first}/transcripts/recordings`,
      { file: made.recordingFile },
    );
    expect(
      ((await again.json()) as { transcript: StageTranscript }).transcript.id,
    ).toBe(made.recorded);
    expect(
      stageRecordingsResponseSchema.parse(
        await (await mine.get(`${path()}/recordings`)).json(),
      ).recordings[0]?.attached,
    ).toBe(true);
    // Another member's recording is never attached, whoever names it.
    const stolen = await mine.post(
      `${path()}/stages/${made.first}/transcripts/recordings`,
      { file: made.strangerFile },
    );
    expect([stolen.status, await codeOf(stolen)]).toEqual([404, "not-found"]);

    const detail = stageTranscriptDetailSchema.parse(
      (
        (await (
          await mine.get(
            `${path()}/stages/${made.first}/transcripts/${made.recorded}`,
          )
        ).json()) as { transcript: unknown }
      ).transcript,
    );
    expect(detail.text).toBe(RECORDED);
    expect(detail.spoken).toEqual([
      {
        speaker: "Interviewer",
        text: "how do you decide when a feature should be a service of its own",
        startMs: 38_394_000,
        endMs: 38_409_000,
      },
      {
        speaker: "Me",
        text: "by who owns the data and how often it ships at Harbourline the berth scheduler shipped daily on its own",
        startMs: 38_412_000,
        endMs: 38_452_000,
      },
    ]);
    // The list never carries the words.
    const brief = await briefOf(await mine.get(`${path()}/interview-brief`));
    expect(JSON.stringify(brief)).not.toContain("berth scheduler shipped");
    expect(
      stageIn(brief, made.first).transcripts.map((each) => each.id),
    ).toEqual([made.pasted, made.recorded]);
  });

  it("never lets a device-only recording be made sendable, and lets the person decide for what they pasted", async () => {
    const mine = as(ids.owner);
    const loosened = await mine.patch(
      `${path()}/stages/${made.first}/transcripts/${made.recorded}`,
      { capturePolicy: "permitted-remote" },
    );
    expect([loosened.status, await codeOf(loosened)]).toEqual([
      409,
      "loosening-refused",
    ]);
    const tightened = await mine.patch(
      `${path()}/stages/${made.first}/transcripts/${made.pasted}`,
      { capturePolicy: "device-only", title: "Call with Dana (first)" },
    );
    expect(
      ((await tightened.json()) as { transcript: StageTranscript }).transcript,
    ).toMatchObject({
      capturePolicy: "device-only",
      sendable: false,
      title: "Call with Dana (first)",
    });
    const back = await mine.patch(
      `${path()}/stages/${made.first}/transcripts/${made.pasted}`,
      { capturePolicy: "permitted-remote" },
    );
    expect(
      ((await back.json()) as { transcript: StageTranscript }).transcript
        .sendable,
    ).toBe(true);
    // Text pasted with no policy named stays on this device.
    const quiet = await mine.post(
      `${path()}/stages/${made.second}/transcripts`,
      { text: "Priya: One more thing about the rota." },
    );
    const kept = ((await quiet.json()) as { transcript: StageTranscript })
      .transcript;
    expect(kept).toMatchObject({
      capturePolicy: "device-only",
      sendable: false,
    });
    expect(
      (
        await mine.remove(
          `${path()}/stages/${made.second}/transcripts/${kept.id}`,
        )
      ).status,
    ).toBe(200);
  });

  it("keeps what the employer said as dated entries, and research as documents", async () => {
    const mine = as(ids.owner);
    const said = await mine.post(`${path()}/employer-said`, {
      said: "No AI assistants during live interviews. The technical round is two hours.",
      saidBy: "Sam Reyes",
      channel: "email",
      saidOn: "2026-10-28",
    });
    expect(said.status).toBe(201);
    await mine.post(`${path()}/employer-said`, {
      said: "They are hiring two principals this quarter.",
    });
    const pasted = await mine.post(`${path()}/research`, {
      title: "Company overview",
      text: "# What they sell\nLarkspur sells tide forecasts to marinas.\n\nPricing: per berth, per month.",
    });
    expect(pasted.status).toBe(201);
    await mine.post(`${path()}/research`, {
      scope: "company",
      title: "Engineering blog",
      originRef: "https://example.invalid/blog/forecasting",
      text: "The forecasting pipeline is rebuilt every night.",
    });
    const form = new FormData();
    form.set("scope", "application");
    form.set(
      "file",
      new File(
        ["Interviewer background: ten years at a port authority."],
        "panel.md",
      ),
    );
    const uploaded = await mine.upload(`${path()}/research/upload`, form);
    expect(uploaded.status).toBe(201);
    const brief = await briefOf(uploaded);
    // An entry with no date comes first: the old single text reads as one.
    expect(
      brief.employerSaid.map(({ said, saidBy, channel, saidOn }) => [
        said.slice(0, 12),
        saidBy,
        channel,
        saidOn,
      ]),
    ).toEqual([
      ["They are hir", null, null, null],
      ["No AI assist", "Sam Reyes", "email", "2026-10-28"],
    ]);
    expect(
      brief.research.map(({ title, scope, origin, originRef, carried }) => [
        title,
        scope,
        origin,
        originRef,
        carried,
      ]),
    ).toEqual([
      ["Company overview", "application", "pasted", null, false],
      [
        "Engineering blog",
        "company",
        "url",
        "https://example.invalid/blog/forecasting",
        false,
      ],
      ["panel", "application", "file", "panel.md", false],
    ]);
    for (const document of brief.research) {
      expect(document.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(document.updatedAt).not.toBeNull();
    }
    const overview = brief.research[0];
    const detail = (await (
      await mine.get(`${path()}/research/${overview?.id}`)
    ).json()) as { document: { text: string; chars: number } };
    expect(detail.document.text).toContain("Pricing: per berth");
    expect(detail.document.chars).toBe(detail.document.text.length);
  });
});

describe("who may read and write it", () => {
  const reads = () => [
    `${path()}/interview-brief`,
    `${path()}/recordings`,
    `${path()}/stages/${made.first}/transcripts/${made.recorded}`,
    `${path()}/research/${CARRIED_RESEARCH_ID}`,
  ];

  it("answers another member of the same workspace as if it did not exist", async () => {
    const theirs = as(ids.other);
    for (const each of reads()) {
      const response = await theirs.get(each);
      expect([each, response.status]).toEqual([each, 404]);
      expect(await codeOf(response)).toBe("not-found");
    }
    const writes = [
      await theirs.post(`${path()}/stages`, { kind: "final", label: "Final" }),
      await theirs.patch(`${path()}/stages/${made.first}`, { notes: "mine" }),
      await theirs.remove(`${path()}/stages/${made.first}`),
      await theirs.put(`${path()}/stages/order`, {
        order: [made.second, made.first],
      }),
      await theirs.post(`${path()}/notes/move`),
      await theirs.post(`${path()}/stages/${made.first}/transcripts`, {
        text: "A: hello",
      }),
      await theirs.remove(
        `${path()}/stages/${made.first}/transcripts/${made.pasted}`,
      ),
      await theirs.post(`${path()}/employer-said`, { said: "x" }),
      await theirs.post(`${path()}/research`, { title: "t", text: "x" }),
      await theirs.post(`${path()}/research/keep-carried`),
    ];
    expect(writes.map((response) => response.status)).toEqual(
      writes.map(() => 404),
    );
    // Nothing of theirs was written.
    const brief = await briefOf(
      await as(ids.owner).get(`${path()}/interview-brief`),
    );
    expect(brief.stages).toHaveLength(2);
    expect(brief.employerSaid).toHaveLength(2);
    expect(brief.research).toHaveLength(3);
  });

  it("lets a read-only member read their own and refuses every write", async () => {
    const reader = as(ids.owner, { permissions: ["interview.read"] });
    const read = await reader.get(`${path()}/interview-brief`);
    expect(read.status).toBe(200);
    expect((await briefOf(read)).stages).toHaveLength(2);
    expect(
      (
        await reader.get(
          `${path()}/stages/${made.first}/transcripts/${made.pasted}`,
        )
      ).status,
    ).toBe(200);
    const writes = [
      await reader.post(`${path()}/stages`, { kind: "final", label: "Final" }),
      await reader.patch(`${path()}/stages/${made.first}`, { notes: "x" }),
      await reader.remove(`${path()}/stages/${made.second}`),
      await reader.post(`${path()}/employer-said`, { said: "x" }),
      await reader.post(`${path()}/research`, { title: "t", text: "x" }),
      await reader.post(`${path()}/stages/${made.first}/transcripts`, {
        text: "A: hello",
      }),
    ];
    for (const response of writes) {
      expect(response.status).toBe(401);
      expect(await codeOf(response)).toBe("unauthorized");
    }
    // A member with no Interview permission reads nothing.
    expect(
      (
        await as(ids.owner, { permissions: [] }).get(
          `${path()}/interview-brief`,
        )
      ).status,
    ).toBe(401);
  });

  it("answers a member of another workspace as if it did not exist", async () => {
    const outside = as(ids.outsider, {
      slug: "elsewhere",
      tenantId: ids.elsewhere,
    });
    for (const each of reads())
      expect([each, (await outside.get(each)).status]).toEqual([each, 404]);
    expect(
      (await outside.post(`${path()}/employer-said`, { said: "x" })).status,
    ).toBe(404);
    // The owner themselves, naming a workspace they are not acting in.
    expect(
      (
        await as(ids.owner, { slug: "elsewhere", tenantId: ids.elsewhere }).get(
          `${path()}/interview-brief`,
        )
      ).status,
    ).toBe(404);
  });

  // [SAFETY] The routes above check ownership themselves. This reads the
  // tables directly, with no such check: only forced row-level security
  // stands between a member and another's rows, so a missing or loosened
  // policy on any of the three tables fails here.
  it("holds row-level security on the three tables with no help from the routes", async () => {
    const tables = [
      interviewTranscripts,
      employerSaidEntries,
      researchDocuments,
    ] as const;
    const count = (tenantId: string, actorId: string) =>
      withTenant(
        { tenantId, actorId },
        async (db) =>
          Promise.all(
            tables.map(async (table) => (await db.select().from(table)).length),
          ),
        { database },
      );
    expect(await count(ids.tenant, ids.owner)).toEqual([2, 2, 3]);
    // Another member of the workspace, and a member of another workspace.
    expect(await count(ids.tenant, ids.other)).toEqual([0, 0, 0]);
    expect(await count(ids.elsewhere, ids.outsider)).toEqual([0, 0, 0]);
    // The owner's id in a workspace that is not the rows': still nothing.
    expect(await count(ids.elsewhere, ids.owner)).toEqual([0, 0, 0]);

    const failure = (work: Promise<unknown>) =>
      work.then(
        () => "written",
        (error: unknown) =>
          `${(error as Error).message} ${(error as { cause?: Error }).cause?.message ?? ""}`,
      );
    // A row cannot be written for another member, or into another workspace.
    expect(
      await failure(
        withTenant(
          { tenantId: ids.tenant, actorId: ids.other },
          (db) =>
            db.insert(employerSaidEntries).values({
              tenantId: ids.tenant,
              ownerUserId: ids.owner,
              candidacyId: made.candidacy,
              said: "planted",
              contentSha256: "0".repeat(64),
            }),
          { database },
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await failure(
        withTenant(
          { tenantId: ids.elsewhere, actorId: ids.outsider },
          (db) =>
            db.insert(researchDocuments).values({
              tenantId: ids.tenant,
              ownerUserId: ids.outsider,
              companyId: made.candidacy,
              title: "planted",
              origin: "pasted",
              content: "x",
              contentSha256: "0".repeat(64),
              chars: 1,
            }),
          { database },
        ),
      ),
    ).toMatch(/row-level security/);
    // Another member cannot change or remove the owner's rows.
    const touched = await withTenant(
      { tenantId: ids.tenant, actorId: ids.other },
      async (db) => [
        (
          await db
            .update(interviewTranscripts)
            .set({ capturePolicy: "permitted-remote" })
            .returning({ id: interviewTranscripts.id })
        ).length,
        (
          await db
            .delete(researchDocuments)
            .returning({ id: researchDocuments.id })
        ).length,
      ],
      { database },
    );
    expect(touched).toEqual([0, 0]);

    // The catalog agrees: enabled and FORCED, with one policy for every
    // command whose WITH CHECK is its USING, naming tenant and owner.
    const names = [
      "interview_transcripts",
      "employer_said_entries",
      "research_documents",
    ];
    const flags = await pg.owner.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'interview' AND c.relname = ANY($1) ORDER BY c.relname`,
      [names],
    );
    expect(flags.rows).toEqual(
      [...names].sort().map((relname) => ({
        relname,
        relrowsecurity: true,
        relforcerowsecurity: true,
      })),
    );
    const policies = await pg.owner.query<{
      tablename: string;
      cmd: string;
      qual: string;
      with_check: string;
    }>(
      `SELECT tablename, cmd, qual, with_check FROM pg_policies
        WHERE schemaname = 'interview' AND tablename = ANY($1)`,
      [names],
    );
    expect(policies.rows).toHaveLength(3);
    for (const policy of policies.rows) {
      expect(policy.cmd).toBe("ALL");
      expect(policy.with_check).toBe(policy.qual);
      expect(policy.qual).toContain("app.tenant_id");
      expect(policy.qual).toContain("app.actor_id");
      expect(policy.qual).toContain("owner_user_id");
    }
    // Every reference to a tenant-owned row is composite on the tenant.
    const references = await pg.owner.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE contype = 'f' AND conrelid::regclass::text = ANY($1)
          AND confrelid::regclass::text LIKE 'interview.%'`,
      [names.map((name) => `interview.${name}`)],
    );
    expect(references.rows.map((row) => row.conname).sort()).toEqual([
      "employer_said_entries_candidacy_fkey",
      "interview_transcripts_interview_fkey",
      "research_documents_candidacy_fkey",
      "research_documents_company_fkey",
    ]);
    for (const reference of references.rows)
      expect(reference.def).toMatch(
        /^FOREIGN KEY \(tenant_id, \w+\) REFERENCES/,
      );
  });
});

describe("the upload paths", () => {
  const transcripts = () => `${path()}/stages/${made.second}/transcripts`;
  const fileForm = (file: File, fields: Record<string, string> = {}) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set("file", file);
    return form;
  };

  it("reads an uploaded WebVTT file into turns, device-only unless said otherwise", async () => {
    const mine = as(ids.owner);
    const response = await mine.upload(
      `${transcripts()}/upload`,
      fileForm(new File([VTT], "design-round.vtt"), {
        occurredAt: "2026-11-12T18:00:00.000Z",
      }),
    );
    expect(response.status).toBe(201);
    const { transcript } = (await response.json()) as {
      transcript: StageTranscript;
    };
    expect(transcript).toMatchObject({
      title: "design-round",
      origin: "uploaded",
      originName: "design-round.vtt",
      capturePolicy: "device-only",
      sendable: false,
      occurredAt: "2026-11-12T18:00:00.000Z",
      turns: 2,
      stageId: made.second,
    });
    const detail = stageTranscriptDetailSchema.parse(
      (
        (await (
          await mine.get(`${transcripts()}/${transcript.id}`)
        ).json()) as { transcript: unknown }
      ).transcript,
    );
    expect(detail.spoken).toEqual([
      {
        speaker: "Priya",
        text: "Walk me through the design round.",
        startMs: 1000,
        endMs: 4000,
      },
      {
        speaker: "Me",
        text: "I start from the invariants.",
        startMs: 5000,
        endMs: 9500,
      },
    ]);
    const allowed = await mine.patch(`${transcripts()}/${transcript.id}`, {
      capturePolicy: "permitted-remote",
    });
    expect(
      ((await allowed.json()) as { transcript: StageTranscript }).transcript
        .sendable,
    ).toBe(true);
  });

  it("refuses an oversized transcript, uploaded or pasted, and stores nothing", async () => {
    const mine = as(ids.owner);
    const before = await briefOf(await mine.get(`${path()}/interview-brief`));
    const large = "A: word\n".repeat(
      Math.ceil(INTERVIEW_BRIEF_BOUNDS.transcriptUploadBytes / 8) + 1,
    );
    const uploaded = await mine.upload(
      `${transcripts()}/upload`,
      fileForm(new File([large], "long.txt")),
    );
    expect([uploaded.status, await codeOf(uploaded)]).toEqual([
      413,
      "body-too-large",
    ]);
    // A declared length over the bound is refused before a byte is read.
    const declared = await mine.raw(transcripts(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(
          INTERVIEW_BRIEF_BOUNDS.transcriptUploadBytes * 2 + 1,
        ),
      },
      body: JSON.stringify({ text: "A: hello" }),
    });
    expect([declared.status, await codeOf(declared)]).toEqual([
      413,
      "body-too-large",
    ]);
    // Within the body's bound, past the transcript's own: the contract refuses.
    const pasted = await mine.post(transcripts(), {
      text: "a".repeat(INTERVIEW_BRIEF_BOUNDS.transcriptChars + 1),
    });
    expect([pasted.status, await codeOf(pasted)]).toEqual([
      400,
      "invalid-request",
    ]);
    const after = await briefOf(await mine.get(`${path()}/interview-brief`));
    expect(stageIn(after, made.second).transcripts).toEqual(
      stageIn(before, made.second).transcripts,
    );
  });

  it("refuses a malformed transcript: not text, nothing said, or not a transcript file", async () => {
    const mine = as(ids.owner);
    const cases: Array<[File, number, string]> = [
      // Bytes that are not UTF-8.
      [
        new File([new Uint8Array([0xff, 0xfe, 0x00, 0x41])], "call.txt"),
        422,
        "invalid-transcript",
      ],
      // Text with a NUL in it: a binary file renamed.
      [
        new File(["Dana: hello\u0000there"], "call.txt"),
        422,
        "invalid-transcript",
      ],
      // A WebVTT file in which nobody speaks.
      [
        new File(
          ["WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n\n"],
          "silent.vtt",
        ),
        422,
        "invalid-transcript",
      ],
      // A format `readTranscript` does not read.
      [new File(["%PDF-1.7"], "call.pdf"), 415, "unsupported-format"],
    ];
    for (const [file, status, code] of cases) {
      const response = await mine.upload(
        `${transcripts()}/upload`,
        fileForm(file),
      );
      expect([file.name, response.status, await codeOf(response)]).toEqual([
        file.name,
        status,
        code,
      ]);
    }
    // A form with no file, a policy that is not one, and blank pasted text.
    const empty = new FormData();
    empty.set("title", "nothing");
    expect((await mine.upload(`${transcripts()}/upload`, empty)).status).toBe(
      400,
    );
    expect(
      (
        await mine.upload(
          `${transcripts()}/upload`,
          fileForm(new File(["A: hello"], "call.txt"), {
            capturePolicy: "anywhere",
          }),
        )
      ).status,
    ).toBe(400);
    expect((await mine.post(transcripts(), { text: "   \n " })).status).toBe(
      400,
    );
    // An unknown field is refused, never ignored.
    expect(
      (await mine.post(transcripts(), { text: "A: hi", owner: ids.other }))
        .status,
    ).toBe(400);
  });

  it("refuses research that is too large or not text, and a transcript past the stage's limit", async () => {
    const mine = as(ids.owner);
    const big = new File(
      ["x".repeat(INTERVIEW_BRIEF_BOUNDS.researchUploadBytes + 1)],
      "big.md",
    );
    const form = (file: File) => {
      const made = new FormData();
      made.set("file", file);
      return made;
    };
    const tooLarge = await mine.upload(`${path()}/research/upload`, form(big));
    expect([tooLarge.status, await codeOf(tooLarge)]).toEqual([
      413,
      "body-too-large",
    ]);
    const binary = await mine.upload(
      `${path()}/research/upload`,
      form(new File(["%PDF-1.7"], "report.pdf")),
    );
    expect([binary.status, await codeOf(binary)]).toEqual([
      415,
      "unsupported-format",
    ]);
    expect(
      (
        await mine.post(`${path()}/research`, {
          title: "Long",
          text: "x".repeat(INTERVIEW_BRIEF_BOUNDS.researchChars + 1),
        })
      ).status,
    ).toBe(400);
    // A link's text must say where it is from.
    expect(
      (
        await mine.post(`${path()}/research`, {
          title: "Link",
          origin: "url",
          text: "x",
        })
      ).status,
    ).toBe(400);

    // The stage takes a bounded number of transcripts.
    const stage = await briefOf(await mine.get(`${path()}/interview-brief`));
    const held = stageIn(stage, made.second).transcripts.length;
    const added: string[] = [];
    for (
      let at = held;
      at < INTERVIEW_BRIEF_BOUNDS.transcriptsPerStage;
      at += 1
    ) {
      const response = await mine.post(
        `${path()}/stages/${made.second}/transcripts`,
        { text: `A: filler number ${at}` },
      );
      expect(response.status).toBe(201);
      added.push(
        ((await response.json()) as { transcript: StageTranscript }).transcript
          .id,
      );
    }
    const over = await mine.post(
      `${path()}/stages/${made.second}/transcripts`,
      { text: "A: one too many" },
    );
    expect([over.status, await codeOf(over)]).toEqual([409, "limit-reached"]);
    for (const id of added)
      await mine.remove(`${path()}/stages/${made.second}/transcripts/${id}`);
  });
});

describe("the context pack built from the stored brief, with no model", () => {
  let material: BriefMaterial;
  let sources: BriefSource[];
  const sourceOf = (id: string) => {
    const source = sources.find((each) => each.id === id);
    if (!source) throw new Error(`no source ${id}`);
    return source;
  };

  beforeAll(async () => {
    material = await withTenant(
      { tenantId: ids.tenant, actorId: ids.owner },
      (db) =>
        readBriefMaterial(
          db,
          { tenantId: ids.tenant, actorId: ids.owner },
          made.candidacy,
        ),
      { database },
    );
    sources = briefSources(material);
  });

  it("makes each part a source with its own id, revision, hash and stage", () => {
    const uploaded = material.stages[1]?.transcripts[0]?.id;
    const said = material.employerSaid.map((entry) => entry.id);
    const research = material.research.map((document) => document.id);
    expect(sources.map((source) => source.id)).toEqual([
      `stage:${made.first}:notes`,
      `stage:${made.first}:outcome`,
      `stage:${made.first}:details`,
      `stage:${made.first}:transcript:${made.pasted}`,
      `stage:${made.first}:transcript:${made.recorded}`,
      `stage:${made.second}:notes`,
      `stage:${made.second}:details`,
      `stage:${made.second}:transcript:${uploaded}`,
      ...said.map((id) => `employer-said:${id}`),
      ...research.map((id) => `research:${id}`),
      // The posting: no record of its own, the text a model reads when the
      // application's pack is prepared.
      `posting:${made.candidacy}`,
    ]);
    expect(sources.at(-1)).toMatchObject({
      kind: BRIEF_SOURCE_KINDS.posting,
      text: "Rebuild the forecasting pipeline.",
      sendable: true,
    });
    expect(sources.at(-1)?.records).toBeUndefined();
    for (const source of sources) {
      // The revision is the content hash's first sixteen characters.
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(source.revision).toBe(source.sha256.slice(0, 16));
      expect(source.chars).toBeGreaterThan(0);
    }
    expect(
      sources.map((source) => [source.kind, source.stage ?? null]),
    ).toEqual([
      [BRIEF_SOURCE_KINDS.notes, 1],
      [BRIEF_SOURCE_KINDS.outcome, 1],
      [BRIEF_SOURCE_KINDS.details, 1],
      [BRIEF_SOURCE_KINDS.transcript, 1],
      [BRIEF_SOURCE_KINDS.transcript, 1],
      [BRIEF_SOURCE_KINDS.notes, 2],
      [BRIEF_SOURCE_KINDS.details, 2],
      [BRIEF_SOURCE_KINDS.transcript, 2],
      [BRIEF_SOURCE_KINDS.employerSaid, null],
      [BRIEF_SOURCE_KINDS.employerSaid, null],
      [BRIEF_SOURCE_KINDS.research, null],
      [BRIEF_SOURCE_KINDS.research, null],
      [BRIEF_SOURCE_KINDS.research, null],
      [BRIEF_SOURCE_KINDS.posting, null],
    ]);
    // Every record of a stage's source says its stage, by place and by id.
    for (const source of sources.filter((each) => each.stage !== undefined))
      for (const record of source.records ?? [])
        expect(record.fields).toMatchObject({
          stage: source.stage,
          stageId: source.stageId,
        });
    // A record of the application says none.
    for (const source of sources.filter((each) => each.stage === undefined))
      for (const record of source.records ?? [])
        expect(record.fields).not.toHaveProperty("stage");
  });

  it("splits a stage's notes into lines, as the brief's prep notes are", () => {
    expect(
      (sourceOf(`stage:${made.first}:notes`).records ?? []).map((record) => [
        record.kind,
        record.text,
        record.fields?.["heading"],
        record.locator,
      ]),
    ).toEqual([
      [
        KINDS.prep,
        "NestJS: the Quayside Freight reporting service, 42000 invoices per day.",
        ["NestJS"],
        `/stages/${made.first}/notes/1`,
      ],
      [
        KINDS.prep,
        "Why Larkspur: tide forecasts for 300 marinas.",
        ["Why Larkspur"],
        `/stages/${made.first}/notes/2`,
      ],
    ]);
    expect(
      (sourceOf(`stage:${made.first}:outcome`).records ?? []).map(
        (record) => record.text,
      ),
    ).toEqual([
      "Outcome: Went well; she pressed on data ownership.",
      "Next: A technical round within two weeks.",
    ]);
    expect(
      (sourceOf(`stage:${made.first}:details`).records ?? []).map((record) => [
        record.kind,
        record.text,
      ]),
    ).toEqual([
      [
        KINDS.employerFact,
        "Hiring manager stage: 2026-11-03T17:30:00.000Z, 60 minutes, video",
      ],
      [
        KINDS.employerFact,
        "Hiring manager stage, hiring manager: Dana Whitlow, Head of Platform",
      ],
      [KINDS.employerFact, "Hiring manager stage, recruiter: Sam Reyes"],
    ]);
  });

  it("makes a transcript a source of raw turns: speaker, words and clock time", () => {
    const recorded = sourceOf(
      `stage:${made.first}:transcript:${made.recorded}`,
    );
    expect(recorded.records).toEqual([
      {
        id: `turn:${made.recorded}:0`,
        kind: "transcript-turn",
        text: "how do you decide when a feature should be a service of its own",
        fields: {
          speaker: "Interviewer",
          startMs: 38_394_000,
          endMs: 38_409_000,
          clock: "10:39:54",
          turn: 0,
          transcriptId: made.recorded,
          stage: 1,
          stageId: made.first,
          deviceOnly: true,
        },
        locator: "10:39:54-10:40:09",
      },
      {
        id: `turn:${made.recorded}:1`,
        kind: "transcript-turn",
        text: "by who owns the data and how often it ships at Harbourline the berth scheduler shipped daily on its own",
        fields: {
          speaker: "Me",
          startMs: 38_412_000,
          endMs: 38_452_000,
          clock: "10:40:12",
          turn: 1,
          transcriptId: made.recorded,
          stage: 1,
          stageId: made.first,
          deviceOnly: true,
        },
        locator: "10:40:12-10:40:52",
      },
    ]);
    // A transcript that may be sent says nothing about staying.
    const pasted = sourceOf(`stage:${made.first}:transcript:${made.pasted}`);
    expect(pasted.records).toHaveLength(3);
    for (const record of pasted.records ?? [])
      expect(record.fields).not.toHaveProperty("deviceOnly");
  });

  it("marks the device-only transcript as not sendable, and nothing else", () => {
    const recorded = sourceOf(
      `stage:${made.first}:transcript:${made.recorded}`,
    );
    expect(recorded).toMatchObject({
      capturePolicy: "device-only",
      sendable: false,
    });
    expect(sourceMayLeaveDevice(recorded)).toBe(false);
    const { sendable, withheld } = remoteSources(sources);
    expect(withheld).toEqual([{ id: recorded.id, reason: "device-only" }]);
    expect(sendable).toHaveLength(sources.length - 1);
    expect(sendable.map((source) => source.id)).not.toContain(recorded.id);
    // No word of it is in anything that may be sent.
    expect(JSON.stringify(sendable)).not.toContain("often it ships");
    // The rule itself, on the three cases.
    expect(sourceMayLeaveDevice({ capturePolicy: "permitted-remote" })).toBe(
      true,
    );
    expect(sourceMayLeaveDevice({})).toBe(true);
    expect(
      sourceMayLeaveDevice({
        capturePolicy: "permitted-remote",
        sendable: false,
      }),
    ).toBe(false);
  });

  it("prepares on a real engine: turns are counted and inspectable, and never offered as a fact", async () => {
    const context = contextOf({ interviewBrief: material, stage: null });
    const turnsOf = (of: Awaited<ReturnType<typeof prepareContextPack>>) =>
      of.prepared.records.filter((record) => record.kind === KINDS.turn);
    // The person's own screen: 3 pasted + 2 recorded + 2 uploaded.
    const shown = await prepareContextPack(
      engine,
      sessionSources(context),
      EXECUTION,
      { reader: "device" },
    );
    expect(turnsOf(shown)).toHaveLength(7);
    expect(turnsOf(shown)[0]?.source).toMatchObject({
      id: `stage:${made.first}:transcript:${made.pasted}`,
    });
    // [SAFETY] Any other reader is a prompt sent off this machine (the
    // pack's default): the recording was made under a device-only policy,
    // so its two turns are no part of that pack. 3 pasted + 2 uploaded.
    const pack = await prepareContextPack(
      engine,
      sessionSources(context),
      EXECUTION,
    );
    expect(turnsOf(pack)).toHaveLength(5);
    const recorded = `stage:${made.first}:transcript:${made.recorded}`;
    expect(
      pack.prepared.records.filter((record) => record.source.id === recorded),
    ).toEqual([]);
    expect(
      shown.prepared.records.filter((record) => record.source.id === recorded),
    ).toHaveLength(2);
    for (const reader of [pack, shown])
      for (const projection of ["coach", "answer", "inspect"] as const)
        for (const spoken of [
          "",
          "how do you decide when a feature should be a service of its own",
          "Tell me about the Quayside Freight reporting service.",
        ]) {
          const resolved = reader.resolve(projection, spoken);
          expect(
            [...resolved.selected, ...resolved.excluded].filter((fact) =>
              fact.recordId.startsWith("turn:"),
            ),
          ).toEqual([]);
        }
    // The stage's own notes and what the employer said are offered.
    const prep = pack
      .facts("inspect", "What is your experience with NestJS?")
      .filter((fact) => fact.slot === "prep");
    expect(prep[0]?.text).toBe(
      "NestJS: the Quayside Freight reporting service, 42000 invoices per day.",
    );
    const employer = pack
      .facts("inspect", "Are AI assistants allowed in the live interviews?")
      .filter((fact) => fact.slot === "employer");
    expect(employer.map((fact) => fact.text)).toContain(
      "No AI assistants during live interviews. The technical round is two hours.",
    );
    // Research is the employer's side: never the candidate's own record.
    const research = pack
      .facts("inspect", "How is the forecasting pipeline rebuilt?")
      .filter((fact) => fact.id.startsWith("research:"));
    expect(research.length).toBeGreaterThan(0);
    for (const fact of research) expect(fact.about).toBe("employer");
  });

  it("resolves for stage 2: its records lead, stage 1's follow, and the view says so", async () => {
    const stage = material.stages[1];
    if (!stage) throw new Error("stage missing");
    const context = contextOf({
      interviewBrief: material,
      stage: {
        id: stage.id,
        ordinal: stage.ordinal,
        label: stage.label,
        kind: stage.kind,
      },
    });
    const pack = await prepareStagePack(engine, context, EXECUTION);
    expect(pack.stage).toMatchObject({ ordinal: 2, label: "Technical" });
    expect(pack.stages.map((each) => each.ordinal)).toEqual([1, 2]);
    // Both stages' notes say "reporting service" or "scheduler"; a question
    // both match is led by stage 2's.
    const spoken = "Tell me about the scheduler and the reporting service";
    const view = pack.view("inspect", spoken);
    const prep = view.selected.filter((fact) => fact.slot === "prep");
    const stages = prep.map((fact) => fact.stage ?? null);
    expect(prep[0]).toMatchObject({
      stage: 2,
      text: "Scheduler: lead with the Harbourline berth scheduler rewrite in Go.",
    });
    expect(stages).toContain(1);
    // Stage 1's note on the same subject follows it.
    expect(prep.map((fact) => fact.text)).toContain(
      "NestJS: the Quayside Freight reporting service, 42000 invoices per day.",
    );
    expect(view.stage).toMatchObject({ ordinal: 2 });
    expect(view.digest).toMatch(/\+stage:2$/);
    expect(
      pack.facts("inspect", spoken).filter((fact) => fact.slot === "prep")[0]
        ?.text,
    ).toBe(prep[0]?.text);
    expect(
      pack
        .resolve("inspect", spoken)
        .selected.filter((fact) => fact.slot === "prep")
        .map((fact) => fact.recordId),
    ).toEqual(prep.map((fact) => fact.id));
    // Each source says its kind, its stage and whether it may leave.
    const recorded = view.sources.find(
      (source) =>
        source.id === `stage:${made.first}:transcript:${made.recorded}`,
    );
    expect(recorded).toMatchObject({
      kind: "transcript",
      stage: 1,
      records: 2,
      sendable: false,
    });
    expect(
      view.sources.filter((source) => source.sendable === false),
    ).toHaveLength(1);
  });

  it("resolves for stage 1 without stage 2's material, which is listed as out of scope", async () => {
    const context = contextOf({ interviewBrief: material, stage: null });
    const pack = await prepareStagePack(engine, context, EXECUTION, 1);
    expect(pack.stage).toMatchObject({ ordinal: 1 });
    const view = pack.view(
      "inspect",
      "Tell me about the scheduler and the reporting service",
    );
    expect(view.selected.filter((fact) => fact.stage === 2)).toEqual([]);
    const scoped = view.excluded.filter((fact) => fact.reason === "scope");
    expect(scoped.length).toBeGreaterThan(0);
    for (const fact of scoped) expect(fact.stage).toBe(2);
    expect(scoped.map((fact) => fact.text)).toContain(
      "Scheduler: lead with the Harbourline berth scheduler rewrite in Go.",
    );
    expect(
      pack.prepared.records.filter((record) => record.fields?.["stage"] === 2),
    ).toEqual([]);
    // Every stage: nothing is out of scope, and no stage leads.
    const whole = await prepareStagePack(engine, context, EXECUTION, "all");
    expect(whole.stage).toBeNull();
    const all = whole.view("inspect", "scheduler");
    expect(all.excluded.filter((fact) => fact.reason === "scope")).toEqual([]);
    expect(all.stage).toBeNull();
    expect(all.records).toBe(view.records);
  });

  it("links a stage's note to the evidence of the employer it names", async () => {
    const context = contextOf({ interviewBrief: material, stage: null });
    const pack = await prepareStagePack(engine, context, EXECUTION, 2);
    const note = pack.prepared.records.find(
      (record) =>
        record.text ===
        "Scheduler: lead with the Harbourline berth scheduler rewrite in Go.",
    );
    expect(note?.fields?.["links"]).toMatchObject({
      roles: ["role:harbourline:staff-engineer"],
    });
  });
});

describe("editing and removing", () => {
  it("replaces a stage's people whole and clears what is blanked", async () => {
    const mine = as(ids.owner);
    const brief = await briefOf(
      await mine.patch(`${path()}/stages/${made.first}`, {
        people: [
          {
            name: "dana whitlow",
            title: "VP Platform",
            role: "hiring_manager",
          },
        ],
        nextSteps: "  ",
        scheduledAt: null,
        label: "Hiring manager call",
      }),
    );
    const stage = stageIn(brief, made.first);
    // The same person, by name: their title is brought up to date.
    expect(stage.people).toMatchObject([
      { name: "Dana Whitlow", title: "VP Platform", role: "hiring_manager" },
    ]);
    expect(stage).toMatchObject({
      nextSteps: null,
      scheduledAt: null,
      label: "Hiring manager call",
      // What was not named is kept.
      durationMinutes: 60,
      outcome: "Went well; she pressed on data ownership.",
    });
    const known = await pg.owner.query(
      "SELECT 1 FROM interview.people WHERE lower(full_name) = 'dana whitlow'",
    );
    expect(known.rowCount).toBe(1);
    // A bound past the contract's is refused.
    expect(
      (
        await mine.patch(`${path()}/stages/${made.first}`, {
          durationMinutes: 4,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mine.patch(`${path()}/stages/${made.first}`, {
          notes: "x".repeat(INTERVIEW_BRIEF_BOUNDS.notesChars + 1),
        })
      ).status,
    ).toBe(400);
  });

  it("edits and removes an employer-said entry and a research document", async () => {
    const mine = as(ids.owner);
    const before = await briefOf(await mine.get(`${path()}/interview-brief`));
    const undated = before.employerSaid[0];
    const dated = before.employerSaid[1];
    const edited = await briefOf(
      await mine.patch(`${path()}/employer-said/${undated?.id}`, {
        saidOn: "2026-10-30",
        saidBy: "Dana Whitlow",
        channel: "call",
      }),
    );
    const now = edited.employerSaid.find((entry) => entry.id === undated?.id);
    expect(now).toMatchObject({
      said: "They are hiring two principals this quarter.",
      saidOn: "2026-10-30",
      saidBy: "Dana Whitlow",
      channel: "call",
    });
    // A change is a new revision.
    expect(now?.sha256).not.toBe(undated?.sha256);
    // Dated entries read in the order they were said.
    expect(edited.employerSaid.map((entry) => entry.saidOn)).toEqual([
      "2026-10-28",
      "2026-10-30",
    ]);
    const removed = await briefOf(
      await mine.remove(`${path()}/employer-said/${dated?.id}`),
    );
    expect(removed.employerSaid.map((entry) => entry.id)).toEqual([
      undated?.id,
    ]);
    expect(
      (await mine.remove(`${path()}/employer-said/${dated?.id}`)).status,
    ).toBe(404);

    const document = removed.research[0];
    const rewritten = await briefOf(
      await mine.patch(`${path()}/research/${document?.id}`, {
        title: "Company overview (2026)",
        text: "Larkspur sells tide forecasts to 300 marinas.",
        scope: "company",
      }),
    );
    const saved = rewritten.research.find((each) => each.id === document?.id);
    expect(saved).toMatchObject({
      title: "Company overview (2026)",
      scope: "company",
      chars: 45,
    });
    expect(saved?.sha256).not.toBe(document?.sha256);
    const gone = await briefOf(
      await mine.remove(`${path()}/research/${document?.id}`),
    );
    expect(gone.research.map((each) => each.id)).not.toContain(document?.id);
    expect((await mine.get(`${path()}/research/${document?.id}`)).status).toBe(
      404,
    );
    expect((await mine.get(`${path()}/research/not-an-id`)).status).toBe(404);
  });

  it("reorders the stages, and refuses an order that is not exactly them", async () => {
    const mine = as(ids.owner);
    for (const order of [
      [made.first],
      [made.first, made.first],
      [made.first, made.second, made.candidacy],
    ])
      expect((await mine.put(`${path()}/stages/order`, { order })).status).toBe(
        400,
      );
    const swapped = await briefOf(
      await mine.put(`${path()}/stages/order`, {
        order: [made.second, made.first],
      }),
    );
    expect(swapped.stages.map(({ id, ordinal }) => [id, ordinal])).toEqual([
      [made.second, 1],
      [made.first, 2],
    ]);
    const back = await briefOf(
      await mine.put(`${path()}/stages/order`, {
        order: [made.first, made.second],
      }),
    );
    expect(back.stages.map((stage) => stage.id)).toEqual([
      made.first,
      made.second,
    ]);
  });

  it("removes a transcript, and a stage with everything that was its own", async () => {
    const mine = as(ids.owner);
    const without = await briefOf(
      await mine.remove(
        `${path()}/stages/${made.first}/transcripts/${made.pasted}`,
      ),
    );
    expect(
      stageIn(without, made.first).transcripts.map((each) => each.id),
    ).toEqual([made.recorded]);

    // A stage a live session was started for is kept, and says why.
    const session = await one(
      `INSERT INTO interview.active_sessions
         (tenant_id,owner_user_id,processing_policy,expires_at,candidacy_id,interview_id)
       VALUES($1,$2,'permitted_remote',now()+interval '1 hour',$3,$4) RETURNING id`,
      [ids.tenant, ids.owner, made.candidacy, made.second],
    );
    const inUse = await mine.remove(`${path()}/stages/${made.second}`);
    expect([inUse.status, await codeOf(inUse)]).toEqual([409, "stage-in-use"]);
    // Refused whole: its people and transcripts are still there.
    const kept = await briefOf(await mine.get(`${path()}/interview-brief`));
    expect(stageIn(kept, made.second).people).toHaveLength(1);
    expect(stageIn(kept, made.second).transcripts).toHaveLength(1);
    await pg.owner.query(
      "DELETE FROM interview.active_sessions WHERE id = $1",
      [session],
    );

    const removed = await briefOf(
      await mine.remove(`${path()}/stages/${made.second}`),
    );
    expect(removed.stages.map(({ id, ordinal }) => [id, ordinal])).toEqual([
      [made.first, 1],
    ]);
    const left = await pg.owner.query<{ transcripts: string; people: string }>(
      `SELECT (SELECT count(*) FROM interview.interview_transcripts WHERE interview_id = $1) AS transcripts,
              (SELECT count(*) FROM interview.interview_participants WHERE interview_id = $1) AS people`,
      [made.second],
    );
    expect(left.rows[0]).toEqual({ transcripts: "0", people: "0" });
    expect((await mine.remove(`${path()}/stages/${made.second}`)).status).toBe(
      404,
    );
    // A stage added after a removal takes the next place.
    const added = await briefOf(
      await mine.post(`${path()}/stages`, { kind: "final", label: "Final" }),
    );
    expect(added.stages.map((stage) => stage.ordinal)).toEqual([1, 2]);
  });
});

describe("what was stored before stages existed", () => {
  let old = "";
  let stage = "";
  const NOTES =
    "Round: the head of platform, Thursday.\nTell me about yourself: platform work first.";

  beforeAll(async () => {
    // An application as the previous release left one: its notes on the
    // application, its company's research in one text, one bare stage.
    const mine = as(ids.owner);
    const created = (await (
      await mine.post("/candidacies", {
        companyName: "Saltmarsh Robotics",
        title: "Staff Engineer",
        interview: { kind: "other", label: "Interview" },
      })
    ).json()) as { candidacyId: string; interviewId: string };
    old = created.candidacyId;
    stage = created.interviewId;
    expect(
      (
        await mine.patch(`/candidacies/${old}/context`, {
          notes: NOTES,
        })
      ).status,
    ).toBe(200);
    await pg.owner.query(
      `UPDATE interview.companies SET research = $2
        WHERE id = (SELECT company_id FROM interview.candidacies WHERE id = $1)`,
      [old, "Saltmarsh builds dredger arms.\nFounded in a boatyard."],
    );
  });

  it("offers the application's notes to the first stage, and leaves them where they are", async () => {
    const mine = as(ids.owner);
    const brief = await briefOf(
      await mine.get(`/candidacies/${old}/interview-brief`),
    );
    expect(brief.applicationNotes).toBe(NOTES);
    expect(brief.stages[0]).toMatchObject({ notes: null, offeredNotes: NOTES });
    // Still readable where it always was.
    const context = (await (
      await mine.get(`/candidacies/${old}/context`)
    ).json()) as { notes: string };
    expect(context.notes).toBe(NOTES);
    // A second stage is offered nothing.
    const two = await briefOf(
      await mine.post(`/candidacies/${old}/stages`, {
        kind: "technical",
        label: "Technical",
      }),
    );
    expect(two.stages[1]?.offeredNotes).toBeNull();
  });

  it("puts the offered notes in the pack as the first stage's, unless the brief already distilled them", async () => {
    const material = await withTenant(
      { tenantId: ids.tenant, actorId: ids.owner },
      (db) =>
        readBriefMaterial(
          db,
          { tenantId: ids.tenant, actorId: ids.owner },
          old,
        ),
      { database },
    );
    expect(material.stages[0]).toMatchObject({
      notes: NOTES,
      notesCarried: true,
    });
    const offered = briefSources(material).find(
      (source) => source.id === `stage:${stage}:notes`,
    );
    expect(offered?.records?.map((record) => record.text)).toEqual([
      "Round: the head of platform, Thursday.",
      "Tell me about yourself: platform work first.",
    ]);
    expect(offered?.records?.[0]?.fields).toMatchObject({
      stage: 1,
      carried: true,
    });
    // The employer brief's prep notes are these notes, cleaned by the model:
    // the same note is not given twice.
    expect(
      briefSources(material, { skipCarriedNotes: true }).map(
        (source) => source.id,
      ),
    ).not.toContain(`stage:${stage}:notes`);
    // The company's old research text is one document, marked as carried.
    expect(
      briefSources(material)
        .find((source) => source.id === `research:${CARRIED_RESEARCH_ID}`)
        ?.records?.map((record) => record.text),
    ).toEqual(["Saltmarsh builds dredger arms.", "Founded in a boatyard."]);
  });

  it("moves the notes onto the first stage when the person says so", async () => {
    const mine = as(ids.owner);
    const moved = await briefOf(
      await mine.post(`/candidacies/${old}/notes/move`),
    );
    expect(moved.applicationNotes).toBeNull();
    expect(moved.stages[0]).toMatchObject({ notes: NOTES, offeredNotes: null });
    const context = (await (
      await mine.get(`/candidacies/${old}/context`)
    ).json()) as { notes: string | null };
    expect(context.notes).toBeNull();
    // Nothing left to move.
    const again = await mine.post(`/candidacies/${old}/notes/move`);
    expect([again.status, await codeOf(again)]).toEqual([
      409,
      "nothing-to-carry",
    ]);
    // Notes typed on the application afterwards join what the stage holds.
    await mine.patch(`/candidacies/${old}/context`, { notes: "One more." });
    const joined = await briefOf(
      await mine.post(`/candidacies/${old}/notes/move`),
    );
    expect(joined.stages[0]?.notes).toBe(`${NOTES}\n\nOne more.`);
  });

  it("offers the company's research as one document, and keeps it when the person says so", async () => {
    const mine = as(ids.owner);
    const brief = await briefOf(
      await mine.get(`/candidacies/${old}/interview-brief`),
    );
    expect(brief.research).toMatchObject([
      {
        id: CARRIED_RESEARCH_ID,
        scope: "company",
        title: "Company research",
        origin: "pasted",
        carried: true,
        createdAt: null,
      },
    ]);
    const detail = (await (
      await mine.get(`/candidacies/${old}/research/${CARRIED_RESEARCH_ID}`)
    ).json()) as { document: { text: string } };
    expect(detail.document.text).toContain("dredger arms");
    // It is not a row yet: it cannot be edited or removed as one.
    expect(
      (
        await mine.patch(
          `/candidacies/${old}/research/${CARRIED_RESEARCH_ID}`,
          {
            title: "x",
          },
        )
      ).status,
    ).toBe(400);

    const kept = await briefOf(
      await mine.post(`/candidacies/${old}/research/keep-carried`),
    );
    expect(kept.research).toHaveLength(1);
    expect(kept.research[0]).toMatchObject({
      scope: "company",
      title: "Company research",
      carried: false,
    });
    expect(kept.research[0]?.id).not.toBe(CARRIED_RESEARCH_ID);
    const company = await pg.owner.query<{ research: string | null }>(
      `SELECT research FROM interview.companies
        WHERE id = (SELECT company_id FROM interview.candidacies WHERE id = $1)`,
      [old],
    );
    expect(company.rows[0]?.research).toBeNull();
    const again = await mine.post(`/candidacies/${old}/research/keep-carried`);
    expect([again.status, await codeOf(again)]).toEqual([
      409,
      "nothing-to-carry",
    ]);
    // A document of the company is read by another application to it.
    const sibling = (await (
      await mine.post("/candidacies", {
        companyName: "Saltmarsh Robotics",
        title: "Principal Engineer",
      })
    ).json()) as { candidacyId: string };
    const theirs = await briefOf(
      await mine.get(`/candidacies/${sibling.candidacyId}/interview-brief`),
    );
    expect(theirs.research.map((document) => document.id)).toEqual([
      kept.research[0]?.id,
    ]);
  });
});
