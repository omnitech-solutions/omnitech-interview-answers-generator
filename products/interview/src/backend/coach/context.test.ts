// What the coach is given of a live session's approved material: the facts
// the context pack's "coach" projection selects for what was just said
// (ADR-0038), each named for whose it is, the material read once a minute at
// most. The database reader is replaced; the pack is the real one, on a real
// AI engine with no model behind it. Every fact here is invented.
import { createAiEngine } from "@omnitech/ai-engine";
import type { PlatformDatabase } from "@omnitech/database";
import type { CandidateMatrix } from "@omnitech/interview-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contextOf, MATRIX } from "../context-pack/fixture";
import {
  type ContextEngine,
  prepareContextPack,
  sessionSources,
} from "../context-pack/index";
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

// No profile and no provider: a call to a model would fail.
const real = createAiEngine({ profiles: [], providers: {} });
// The real engine, counting how often the material is prepared.
function counted(prepare = real.context.prepare.bind(real.context)) {
  const prepared = vi.fn(prepare);
  const engine: ContextEngine = {
    context: {
      prepare: prepared as typeof real.context.prepare,
      resolve: real.context.resolve.bind(real.context),
    },
  };
  return { engine, prepared };
}

function clocked(engine: ContextEngine = real) {
  let now = Date.parse("2026-10-08T09:00:00.000Z");
  return {
    context: createCoachContext(DATABASE, engine, () => now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const GO = "Have you used Go?";

beforeEach(() => {
  load.mockReset();
});

describe("the coach's facts for a live session", () => {
  it("reads the session's material as the session's owner", async () => {
    load.mockResolvedValue(contextOf());
    await clocked().context.facts(SESSION, GO);
    expect(load.mock.calls).toEqual([
      [
        DATABASE,
        { tenantId: SESSION.tenantId, actorId: SESSION.actorId },
        SESSION.sessionId,
      ],
    ]);
  });

  it("prepares it for that owner and session, to read, as the interview product", async () => {
    load.mockResolvedValue(contextOf());
    const { engine, prepared } = counted();
    await clocked(engine).context.facts(SESSION, GO);
    expect(prepared).toHaveBeenCalledTimes(1);
    const [input, execution] = prepared.mock.calls[0] ?? [];
    expect(input?.sources.map((source) => source.id)).toEqual([
      "matrix:profile-1",
      "brief:candidacy-1",
      "preferences:draft",
    ]);
    expect(input?.recipe).toMatchObject({ id: "interview-context" });
    expect(execution).toMatchObject({
      scope: {
        tenantId: SESSION.tenantId,
        actorId: SESSION.actorId,
        productId: "omnitech.interview",
      },
      permissions: ["interview.read"],
      for: { kind: "session", id: SESSION.sessionId },
    });
    expect(execution?.signal).toBeInstanceOf(AbortSignal);
  });

  it("gives exactly what the pack's coach projection selects, in its order", async () => {
    const held = contextOf();
    load.mockResolvedValue(held);
    const pack = await prepareContextPack(real, sessionSources(held), {
      scope: SESSION,
      signal: new AbortController().signal,
    });
    const { context } = clocked();
    for (const question of [
      GO,
      "Tell me about a conflict with a stakeholder",
      "What are your salary expectations?",
      "Tell me about yourself",
      "",
    ]) {
      const facts = await context.facts(SESSION, question);
      const selected = pack.facts("coach", question);
      expect(facts.length, question).toBe(selected.length);
      expect(
        facts.map((fact) => [fact.pointer, fact.about]),
        question,
      ).toEqual(selected.map((fact) => [fact.pointer, fact.about]));
      // A ranked fact is given in its own words.
      expect(
        facts.filter((_, index) => !selected[index]?.exact),
        question,
      ).toEqual(
        selected
          .filter((fact) => !fact.exact)
          .map(({ pointer, text, about }) => ({ pointer, text, about })),
      );
      // The answer and inspect projections select more; the coach is not
      // given them.
      expect(facts.length).toBeLessThanOrEqual(
        pack.facts("inspect", question).length,
      );
    }
  });

  it("labels a looked-up field with what it is", async () => {
    load.mockResolvedValue(contextOf());
    const facts = await clocked().context.facts(SESSION, GO);
    expect(facts.slice(0, 5)).toEqual([
      { pointer: "/candidate", text: "Name: Mira Okonjo", about: "candidate" },
      {
        pointer: "/candidate",
        text: "Headline: Platform engineer",
        about: "candidate",
      },
      { pointer: "/candidate", text: "Location: Lisbon", about: "candidate" },
      {
        pointer: "/context/employerBrief",
        text: "Company: Larkspur Analytics",
        about: "employer",
      },
      {
        pointer: "/context/employerBrief",
        text: "Role: Principal Engineer",
        about: "employer",
      },
    ]);
    // Nothing ranked is labelled.
    for (const fact of facts.slice(5))
      expect(fact.text).not.toMatch(/^(Name|Headline|Location|Company|Role): /);
  });

  it("says whose each fact is: the candidate's record, the employer's material, a preference", async () => {
    load.mockResolvedValue(contextOf());
    const { context } = clocked();
    const facts = [
      ...(await context.facts(SESSION, "Tell me about your NestJS work")),
      ...(await context.facts(SESSION, "What is your notice period?")),
    ];
    for (const fact of facts)
      expect(Object.keys(fact).sort()).toEqual(["about", "pointer", "text"]);
    expect(facts).toContainEqual({
      pointer: "/roles/1/proof_points/0",
      text: "Built a NestJS reporting service for dock invoices",
      about: "candidate",
    });
    expect(facts).toContainEqual({
      pointer: expect.stringMatching(/^brief:mustHaves:/),
      text: "Five years of NestJS in production",
      about: "employer",
    });
    expect(facts).toContainEqual({
      pointer: "/context/candidatePreferences/1",
      text: "Notice period: four weeks.",
      about: "preference",
    });
    // Nothing of the employer's is ever the candidate's, and the reverse:
    // the candidate's facts are the ones addressed inside the matrix.
    for (const fact of facts)
      expect(
        /^\/(candidate|roles|story_selector)(\/|$)/.test(fact.pointer),
        fact.pointer,
      ).toBe(fact.about === "candidate");
  });

  it("ranks each call's own question", async () => {
    load.mockResolvedValue(contextOf());
    const { context } = clocked();
    const go = await context.facts(SESSION, GO);
    const pay = await context.facts(
      SESSION,
      "What are your salary expectations?",
    );
    expect(go.map((fact) => fact.text)).toContain(
      "Rewrote the berth scheduler in Go for the harbour pilots",
    );
    expect(go.some((fact) => fact.about === "preference")).toBe(false);
    expect(pay.slice(5)).toEqual([
      {
        pointer: "/context/candidatePreferences/0",
        text: "Base salary: 140k minimum.",
        about: "preference",
      },
    ]);
  });

  it("gives only the candidate's record when the session has no employer material or preferences", async () => {
    load.mockResolvedValue(
      contextOf({ brief: null, candidatePreferences: null }),
    );
    const facts = await clocked().context.facts(SESSION, GO);
    expect(facts.length).toBeGreaterThan(3);
    expect(new Set(facts.map((fact) => fact.about))).toEqual(
      new Set(["candidate"]),
    );
  });

  it("gives what material there is when no profile is pinned", async () => {
    load.mockResolvedValue(
      contextOf(
        {
          profile: null,
          brief: null,
          candidatePreferences: "Notice: 4 weeks.",
        },
        null,
      ),
    );
    expect(
      await clocked().context.facts(SESSION, "What is your notice period?"),
    ).toEqual([
      {
        pointer: "/context/candidatePreferences/0",
        text: "Notice: 4 weeks.",
        about: "preference",
      },
    ]);
  });

  it("gives no facts for a session with no material at all", async () => {
    load.mockResolvedValue(
      contextOf(
        { profile: null, brief: null, candidatePreferences: null },
        null,
      ),
    );
    expect(await clocked().context.facts(SESSION, GO)).toEqual([]);
  });

  it("gives no facts for a session context that carries no material", async () => {
    const { material: _material, ...bare }: SessionContext = contextOf();
    load.mockResolvedValue(bare);
    const { context } = clocked();
    expect(await context.facts(SESSION, GO)).toEqual([]);
    expect(await context.facts(SESSION, "")).toEqual([]);
  });
});

describe("how often the material is read", () => {
  it("reads and prepares once for calls on one session inside a minute", async () => {
    load.mockResolvedValue(contextOf());
    const { engine, prepared } = counted();
    const { context, advance } = clocked(engine);
    const first = await context.facts(SESSION, GO);
    advance(59_000);
    const second = await context.facts(SESSION, "What is your notice period?");
    advance(1_000);
    await context.facts(SESSION, "And the uptime?");
    expect(load).toHaveBeenCalledTimes(1);
    expect(prepared).toHaveBeenCalledTimes(1);
    expect(first.length).toBeGreaterThan(5);
    // The second call was ranked for its own question; the read was not
    // repeated.
    expect(second.at(-1)).toEqual({
      pointer: "/context/candidatePreferences/1",
      text: "Notice period: four weeks.",
      about: "preference",
    });
  });

  it("reads again once the minute has passed, and shows what changed", async () => {
    load
      .mockResolvedValueOnce(contextOf())
      .mockResolvedValue(
        contextOf({ candidatePreferences: "Notice period: two weeks." }),
      );
    const { engine, prepared } = counted();
    const { context, advance } = clocked(engine);
    await context.facts(SESSION, "What is your notice period?");
    advance(60_001);
    const again = await context.facts(SESSION, "What is your notice period?");
    expect(load).toHaveBeenCalledTimes(2);
    expect(prepared).toHaveBeenCalledTimes(2);
    expect(again.at(-1)).toMatchObject({
      text: "Notice period: two weeks.",
      about: "preference",
    });
    // The minute is counted from that second read.
    advance(60_000);
    await context.facts(SESSION, "And again?");
    expect(load).toHaveBeenCalledTimes(2);
    advance(1);
    await context.facts(SESSION, "And again?");
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("reads again for another session, and again on coming back to the first", async () => {
    load.mockResolvedValue(contextOf());
    const { context } = clocked();
    await context.facts(SESSION, GO);
    await context.facts(OTHER, GO);
    await context.facts(OTHER, "The uptime?");
    await context.facts(SESSION, GO);
    expect(load.mock.calls.map((call) => call[2])).toEqual([
      SESSION.sessionId,
      OTHER.sessionId,
      SESSION.sessionId,
    ]);
  });

  it("never gives one session another's material", async () => {
    load.mockImplementation(async (_database, _scope, sessionId) =>
      sessionId === SESSION.sessionId
        ? contextOf()
        : contextOf({ brief: null, candidatePreferences: null }, {
            ...MATRIX,
            candidate: { name: "Ines Varga" },
          } as CandidateMatrix),
    );
    const { context } = clocked();
    expect((await context.facts(SESSION, GO))[0]?.text).toBe(
      "Name: Mira Okonjo",
    );
    expect((await context.facts(OTHER, GO))[0]?.text).toBe("Name: Ines Varga");
    expect((await context.facts(SESSION, GO))[0]?.text).toBe(
      "Name: Mira Okonjo",
    );
  });
});

describe("a session whose material cannot be read", () => {
  it("gives no facts, and does not throw", async () => {
    load.mockRejectedValue(new Error("the pinned profile no longer verifies"));
    const { engine, prepared } = counted();
    const { context } = clocked(engine);
    await expect(context.facts(SESSION, GO)).resolves.toEqual([]);
    // Nothing was read, so nothing is prepared.
    expect(prepared).not.toHaveBeenCalled();
  });

  it("is not read again for a minute, then is", async () => {
    load
      .mockRejectedValueOnce(new Error("the session is gone"))
      .mockResolvedValueOnce(contextOf());
    const { context, advance } = clocked();
    expect(await context.facts(SESSION, GO)).toEqual([]);
    advance(60_000);
    expect(await context.facts(SESSION, GO)).toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);
    advance(1);
    expect((await context.facts(SESSION, GO)).length).toBeGreaterThan(0);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("a session whose material cannot be prepared", () => {
  it("gives no facts when the engine refuses the material", async () => {
    load.mockResolvedValue(contextOf());
    const { engine, prepared } = counted(async () => ({
      ok: false,
      failure: {
        code: "invalid-request" as const,
        reason: 'Record "x" has a kind the recipe does not declare',
        retryable: false,
      },
    }));
    const { context } = clocked(engine);
    await expect(context.facts(SESSION, GO)).resolves.toEqual([]);
    expect(prepared).toHaveBeenCalledTimes(1);
  });

  it("gives no facts when preparing throws, and is not tried again for a minute", async () => {
    load.mockResolvedValue(contextOf());
    let broken = true;
    const { engine, prepared } = counted(async (input, execution) => {
      if (broken) throw new Error("the engine is down");
      return real.context.prepare(input, execution);
    });
    const { context, advance } = clocked(engine);
    await expect(context.facts(SESSION, GO)).resolves.toEqual([]);
    broken = false;
    advance(60_000);
    expect(await context.facts(SESSION, GO)).toEqual([]);
    expect(prepared).toHaveBeenCalledTimes(1);
    advance(1);
    expect((await context.facts(SESSION, GO)).length).toBeGreaterThan(0);
    expect(prepared).toHaveBeenCalledTimes(2);
  });
});
