// The session context reader on a disposable PostgreSQL as the application
// role (fixture_member, forced row security): the pinned profile revision is
// read (not a newer one), its hash is re-verified (a mismatch makes the context
// unavailable, never a stale answer), another member's profile or draft is
// never readable through a session row that names it, and the linked briefing
// draft's employer material and candidate preferences are read with the draft
// revision recorded.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContextSnapshot, matrixSha256 } from "./context-snapshot";
import { SessionError } from "./errors";
import { type Fixture, startFixture } from "./live-session-fixture";
import {
  seedBriefingDraft,
  seedMatrixProfile,
  startSessionForPerson,
} from "./processor-fixture";
import {
  CANDIDATE_PREFERENCES,
  SYNTHETIC_MATRIX,
} from "./replay-fixture-matrix";
import { ActiveSessionRepository } from "./repository";
import {
  briefLines,
  loadSessionContext,
  SessionContextUnavailable,
} from "./session-context";

let fx: Fixture;
let repo: ActiveSessionRepository;
const EMPLOYER_TEXT = "Example Corp builds internal tooling for product teams.";

beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 120_000);
afterAll(() => fx.stop());

// A person with a seeded profile and briefing draft, and a session pinning both.
async function linkedWorld(name: string) {
  const person = await fx.provision(fx.tenantA, name);
  const profile = await seedMatrixProfile(fx, fx.tenantA, person.id);
  const draft = await seedBriefingDraft(
    fx,
    fx.tenantA,
    person.id,
    profile,
    {
      candidatePreferences: CANDIDATE_PREFERENCES,
      jobDescription: EMPLOYER_TEXT,
    },
    4,
  );
  const started = await startSessionForPerson(
    fx,
    repo,
    fx.tenantA,
    person,
    "permitted-remote",
    { profile: { id: profile.id }, workspaceDraft: draft },
  );
  return { profile, draft, ...started };
}

// Points a session row at other links, as the fixture owner (the application
// role can never do this: the links are immutable and checked at start).
async function relink(
  sessionId: string,
  columns: Record<string, string | number>,
) {
  const names = Object.keys(columns);
  await fx.owner.query(
    "ALTER TABLE interview.active_sessions DISABLE TRIGGER USER",
  );
  try {
    await fx.owner.query(
      `UPDATE interview.active_sessions SET ${names
        .map((name, index) => `${name} = $${index + 1}`)
        .join(", ")} WHERE id = $${names.length + 1}`,
      [...Object.values(columns), sessionId],
    );
  } finally {
    await fx.owner.query(
      "ALTER TABLE interview.active_sessions ENABLE TRIGGER USER",
    );
  }
}

describe("briefLines", () => {
  const brief = {
    company: "Example Corp",
    role: "Staff Engineer",
    summary: "Platform team hiring a staff engineer.",
    mustHaves: ["TypeScript"],
    niceToHaves: [],
    techStack: [],
    responsibilities: [],
    values: [],
    questionsToAsk: [],
  };

  it("puts the company facts in About lines and each prep note on a Prep line of its own, ahead of the role summary", () => {
    const lines = briefLines({
      ...brief,
      companyFacts: ["Builds internal tooling.", "Founded in 2015"],
      prepNotes: [
        "Round is with the hiring manager; it decides the offer.",
        "Proudest project: the billing migration, 40% fewer incidents",
      ],
    }).split("\n");
    expect(lines).toEqual([
      "Employer brief: Staff Engineer at Example Corp",
      "About Example Corp: Builds internal tooling · Founded in 2015",
      "Prep: Round is with the hiring manager, it decides the offer",
      "Prep: Proudest project: the billing migration, 40% fewer incidents",
      "Role summary: Platform team hiring a staff engineer",
      "Must-haves: TypeScript",
    ]);
  });

  it("emits no About or Prep line for a brief without facts or notes", () => {
    expect(briefLines(brief).split("\n")).toEqual([
      "Employer brief: Staff Engineer at Example Corp",
      "Role summary: Platform team hiring a staff engineer",
      "Must-haves: TypeScript",
    ]);
    expect(briefLines({ ...brief, companyFacts: [], prepNotes: [] })).toBe(
      briefLines(brief),
    );
  });

  it("keeps every prep note as one snapshot source", () => {
    const built = buildContextSnapshot({
      matrix: null,
      profile: null,
      employer: {
        brief: briefLines({
          ...brief,
          prepNotes: [
            "Lead with the result. Then the trade-off; keep it short!",
          ],
        }),
      },
    });
    expect(built.sources.map((source) => source.text)).toContain(
      "Prep: Lead with the result, Then the trade-off, keep it short",
    );
  });
});

describe("loadSessionContext", () => {
  it("reads the pinned profile revision, the draft's preferences and employer material, and records the draft revision", async () => {
    const w = await linkedWorld("ctx-read");
    const context = await loadSessionContext(fx.member, w.scope, w.sessionId);

    expect(context.snapshot.profile).toEqual({
      id: w.profile.id,
      revision: 1,
      sha256: w.profile.sha256,
    });
    expect(context.matrix).toEqual(SYNTHETIC_MATRIX);
    expect(context.snapshot.draftRevision).toBe(4);
    const byKind = (kind: string) =>
      context.snapshot.sources.filter((source) => source.sourceKind === kind);
    expect(
      byKind("candidate").some(
        (source) => source.pointer === "/roles/0/responsibilities/0",
      ),
    ).toBe(true);
    expect(byKind("candidate-preference").map((s) => s.text)).toEqual([
      "Notice period: two weeks.",
      "Compensation: open to a range in line with market for the level, to discuss after the technical stages.",
    ]);
    expect(byKind("employer-context").map((s) => s.text)).toEqual([
      EMPLOYER_TEXT,
    ]);
    expect(context.snapshot.preferences).toEqual({
      noticePeriod: true,
      compensation: true,
      other: false,
    });
    // Context sources carry the draft revision they were read at.
    expect(byKind("candidate-preference").every((s) => s.revision === 4)).toBe(
      true,
    );
  }, 60_000);

  it("reads the pinned revision, not a newer one", async () => {
    const w = await linkedWorld("ctx-pinned");
    const newer = {
      ...SYNTHETIC_MATRIX,
      candidate: {
        ...SYNTHETIC_MATRIX.candidate,
        headline: "A newer headline",
      },
    };
    await fx.owner.query(
      "INSERT INTO interview.candidate_profile_revisions(tenant_id,actor_id,product_id,id,revision,name,sha256,matrix) VALUES($1,$2,'omnitech.interview',$3,2,'Synthetic profile',$4,$5::jsonb)",
      [
        fx.tenantA,
        w.person.id,
        w.profile.id,
        matrixSha256(newer),
        JSON.stringify(newer),
      ],
    );
    await fx.owner.query(
      "UPDATE interview.candidate_profiles SET revision = 2 WHERE id = $1",
      [w.profile.id],
    );

    const context = await loadSessionContext(fx.member, w.scope, w.sessionId);
    expect(context.snapshot.profile?.revision).toBe(1);
    expect(context.matrix).toEqual(SYNTHETIC_MATRIX);
    expect(
      context.snapshot.sources.some((s) => s.text === "A newer headline"),
    ).toBe(false);
  }, 60_000);

  it("refuses a pinned revision whose hash no longer matches", async () => {
    const person = await fx.provision(fx.tenantA, "ctx-hash");
    const profile = await seedMatrixProfile(fx, fx.tenantA, person.id, {
      sha256: "f".repeat(64),
    });
    const started = await startSessionForPerson(
      fx,
      repo,
      fx.tenantA,
      person,
      "permitted-remote",
      { profile: { id: profile.id } },
    );
    await expect(
      loadSessionContext(fx.member, started.scope, started.sessionId),
    ).rejects.toMatchObject({
      code: "context_unavailable",
      reason: "profile_hash_mismatch",
    });
    await expect(
      loadSessionContext(fx.member, started.scope, started.sessionId),
    ).rejects.toBeInstanceOf(SessionContextUnavailable);
  }, 60_000);

  it("is unavailable when the pinned profile was revoked", async () => {
    const w = await linkedWorld("ctx-revoked");
    await fx.owner.query(
      "UPDATE interview.candidate_profiles SET revoked_at = now() WHERE id = $1",
      [w.profile.id],
    );
    await expect(
      loadSessionContext(fx.member, w.scope, w.sessionId),
    ).rejects.toMatchObject({
      code: "context_unavailable",
      reason: "profile_unreadable",
    });
  }, 60_000);

  it("refuses another member's profile named by a session row (same tenant)", async () => {
    const victim = await linkedWorld("ctx-victim");
    const attacker = await fx.provision(fx.tenantA, "ctx-attacker");
    const started = await startSessionForPerson(fx, repo, fx.tenantA, attacker);
    await relink(started.sessionId, {
      profile_id: victim.profile.id,
      profile_revision: 1,
    });

    await expect(
      loadSessionContext(fx.member, started.scope, started.sessionId),
    ).rejects.toMatchObject({
      code: "context_unavailable",
      reason: "profile_unreadable",
    });
  }, 60_000);

  it("does not read another member's draft preferences through a session row that names it", async () => {
    const victim = await linkedWorld("ctx-draft-victim");
    const attacker = await fx.provision(fx.tenantA, "ctx-draft-attacker");
    const started = await startSessionForPerson(fx, repo, fx.tenantA, attacker);
    await relink(started.sessionId, {
      workspace_draft_id: JSON.stringify([
        victim.draft.workspaceId,
        victim.draft.artifactId,
      ]),
    });

    const context = await loadSessionContext(
      fx.member,
      started.scope,
      started.sessionId,
    );
    expect(context.snapshot.sources).toEqual([]);
    expect(context.snapshot.draftRevision).toBeNull();
    expect(context.snapshot.preferences.noticePeriod).toBe(false);
  }, 60_000);

  it("answers with an empty snapshot when no profile or draft is pinned", async () => {
    const person = await fx.provision(fx.tenantA, "ctx-none");
    const started = await startSessionForPerson(fx, repo, fx.tenantA, person);
    const context = await loadSessionContext(
      fx.member,
      started.scope,
      started.sessionId,
    );
    expect(context.snapshot.profile).toBeNull();
    expect(context.matrix).toBeNull();
    expect(context.snapshot.sources).toEqual([]);
  }, 60_000);

  it("reads a session that is not the actor's as not found", async () => {
    const w = await linkedWorld("ctx-owner");
    const other = await fx.provision(fx.tenantA, "ctx-other");
    await expect(
      loadSessionContext(
        fx.member,
        { tenantId: fx.tenantA, actorId: other.id },
        w.sessionId,
      ),
    ).rejects.toBeInstanceOf(SessionError);
  }, 60_000);

  it("carries only a code in its failure, never content", async () => {
    const person = await fx.provision(fx.tenantA, "ctx-code");
    const profile = await seedMatrixProfile(fx, fx.tenantA, person.id, {
      sha256: "e".repeat(64),
    });
    const started = await startSessionForPerson(
      fx,
      repo,
      fx.tenantA,
      person,
      "permitted-remote",
      { profile: { id: profile.id } },
    );
    const error = await loadSessionContext(
      fx.member,
      started.scope,
      started.sessionId,
    ).catch((caught: unknown) => caught);
    expect(JSON.stringify(error)).not.toContain("Example Corp");
    expect((error as Error).message).toBe(
      "The session's approved context is unavailable.",
    );
  }, 60_000);
});
