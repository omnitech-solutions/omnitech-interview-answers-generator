// What the coach is given of a live session's approved context: the same
// snapshot the session's own answers read, each source named for whose it is,
// read once a minute at most. The database reader is replaced; the snapshot
// and its ranking are the real ones. Every fact here is invented.
import type { PlatformDatabase } from "@omnitech/database";
import type { CandidateMatrix } from "@omnitech/interview-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildContextSnapshot } from "../live-session/context-snapshot";
import {
  loadSessionContext,
  type SessionContext,
} from "../live-session/session-context";
import { createCoachContext } from "./context";

vi.mock("../live-session/session-context", () => ({
  loadSessionContext: vi.fn(),
}));
const load = vi.mocked(loadSessionContext);

const DATABASE = { name: "the database handle" } as unknown as PlatformDatabase;
const SESSION = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  actorId: "00000000-0000-4000-8000-000000000002",
  sessionId: "00000000-0000-4000-8000-000000000003",
};
const OTHER = { ...SESSION, sessionId: "00000000-0000-4000-8000-000000000004" };

const matrix = {
  candidate: { name: "Mira Okonjo", headline: "Platform engineer" },
  roles: [
    {
      company: "Harbourline",
      title: "Backend engineer",
      technologies: ["PostgreSQL"],
      responsibilities: ["Led a PostgreSQL migration of the tide tables"],
      metrics: [{ label: "uptime", value: "99.9%" }],
    },
  ],
} as unknown as CandidateMatrix;

const contextOf = (
  extra: Partial<Parameters<typeof buildContextSnapshot>[0]> = {},
): SessionContext => ({
  matrix,
  snapshot: buildContextSnapshot({
    matrix,
    profile: { id: "profile-1", revision: 3, sha256: "a".repeat(64) },
    employer: {
      brief:
        "Employer brief: Backend engineer at Quayside\nTech stack: PostgreSQL · Kafka",
    },
    candidatePreferences: "Notice period: four weeks.",
    draftRevision: 2,
    ...extra,
  }),
});

function clocked() {
  let now = Date.parse("2026-10-08T09:00:00.000Z");
  return {
    context: createCoachContext(DATABASE, () => now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

beforeEach(() => {
  load.mockReset();
});

describe("the coach's facts for a live session", () => {
  it("reads the session's context as the session's owner", async () => {
    load.mockResolvedValue(contextOf());
    await clocked().context.facts(SESSION, "Tell me about the migration.");
    expect(load.mock.calls).toEqual([
      [
        DATABASE,
        { tenantId: SESSION.tenantId, actorId: SESSION.actorId },
        SESSION.sessionId,
      ],
    ]);
  });

  it("says whose each fact is: the candidate's record, the employer's material, a preference", async () => {
    const held = contextOf();
    load.mockResolvedValue(held);
    const facts = await clocked().context.facts(
      SESSION,
      "Tell me about the PostgreSQL migration and your notice period.",
    );
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts)
      expect(Object.keys(fact).sort()).toEqual(["about", "pointer", "text"]);

    const kindOf = new Map(
      held.snapshot.sources.map((source) => [source.pointer, source]),
    );
    const ABOUT = {
      candidate: "candidate",
      "employer-context": "employer",
      "candidate-preference": "preference",
    } as const;
    for (const fact of facts) {
      const source = kindOf.get(fact.pointer);
      expect(source?.text, fact.pointer).toBe(fact.text);
      expect(fact.about, fact.pointer).toBe(
        ABOUT[source?.sourceKind as keyof typeof ABOUT],
      );
    }
    expect(facts).toContainEqual({
      pointer: "/roles/0/responsibilities/0",
      text: "Led a PostgreSQL migration of the tide tables",
      about: "candidate",
    });
    expect(facts).toContainEqual({
      pointer: "/context/employerBrief/0",
      text: "Employer brief: Backend engineer at Quayside",
      about: "employer",
    });
    expect(
      facts.filter((fact) => fact.about === "preference").map((f) => f.text),
    ).toEqual(["Notice period: four weeks."]);
    // Nothing of the employer's is ever the candidate's, and the reverse.
    for (const fact of facts)
      expect(fact.pointer.startsWith("/context/")).toBe(
        fact.about !== "candidate",
      );
  });

  it("gives only the candidate's record when the session has no employer material or preferences", async () => {
    load.mockResolvedValue(
      contextOf({ employer: undefined, candidatePreferences: undefined }),
    );
    const facts = await clocked().context.facts(SESSION, "The migration?");
    expect(facts.length).toBeGreaterThan(0);
    expect(new Set(facts.map((fact) => fact.about))).toEqual(
      new Set(["candidate"]),
    );
  });

  it("gives what context there is when no profile is pinned", async () => {
    load.mockResolvedValue({
      matrix: null,
      snapshot: buildContextSnapshot({
        matrix: null,
        profile: null,
        candidatePreferences: "Notice period: four weeks.",
      }),
    });
    expect(
      await clocked().context.facts(SESSION, "What is your notice period?"),
    ).toEqual([
      {
        pointer: expect.stringMatching(/^\/context\//),
        text: "Notice period: four weeks.",
        about: "preference",
      },
    ]);
  });
});

describe("how often the record is read", () => {
  it("reads once for two calls on one session inside a minute, ranking each call's own question", async () => {
    load.mockResolvedValue(contextOf());
    const { context, advance } = clocked();
    const first = await context.facts(SESSION, "Tell me about the migration.");
    advance(59_000);
    const second = await context.facts(SESSION, "What is your notice period?");
    advance(1_000);
    await context.facts(SESSION, "And the uptime?");
    expect(load).toHaveBeenCalledTimes(1);
    expect(first.length).toBeGreaterThan(0);
    // A notice question puts the preference first; the read was not repeated.
    expect(second[0]).toMatchObject({ about: "preference" });
  });

  it("reads again once the minute has passed, and shows what changed", async () => {
    load.mockResolvedValueOnce(contextOf()).mockResolvedValueOnce(
      contextOf({
        candidatePreferences: "Notice period: two weeks.",
      }),
    );
    const { context, advance } = clocked();
    await context.facts(SESSION, "What is your notice period?");
    advance(60_001);
    const again = await context.facts(SESSION, "What is your notice period?");
    expect(load).toHaveBeenCalledTimes(2);
    expect(again[0]).toMatchObject({
      text: "Notice period: two weeks.",
      about: "preference",
    });
    // The minute is counted from that second read.
    advance(60_000);
    await context.facts(SESSION, "And again?");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reads again for another session, and again on coming back to the first", async () => {
    load.mockResolvedValue(contextOf());
    const { context } = clocked();
    await context.facts(SESSION, "The migration?");
    await context.facts(OTHER, "The migration?");
    await context.facts(OTHER, "The uptime?");
    await context.facts(SESSION, "The migration?");
    expect(load.mock.calls.map((call) => call[2])).toEqual([
      SESSION.sessionId,
      OTHER.sessionId,
      SESSION.sessionId,
    ]);
  });
});

describe("a session whose context cannot be read", () => {
  it("gives no facts, and does not throw", async () => {
    load.mockRejectedValue(new Error("the pinned profile no longer verifies"));
    const { context } = clocked();
    await expect(context.facts(SESSION, "The migration?")).resolves.toEqual([]);
  });

  it("is not read again for a minute, then is", async () => {
    load
      .mockRejectedValueOnce(new Error("the session is gone"))
      .mockResolvedValueOnce(contextOf());
    const { context, advance } = clocked();
    expect(await context.facts(SESSION, "The migration?")).toEqual([]);
    advance(60_000);
    expect(await context.facts(SESSION, "The migration?")).toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);
    advance(1);
    expect(
      (await context.facts(SESSION, "The migration?")).length,
    ).toBeGreaterThan(0);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
