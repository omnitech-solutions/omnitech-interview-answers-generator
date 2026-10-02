import type {
  PlaygroundSnapshot,
  PlaygroundValue,
} from "@omnitech/interview-playground-control";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  draftOf,
  explanationsOf,
  isNewSnapshot,
  planControl,
  readApplied,
  storeApplied,
  writeControlDraft,
} from "./playground-control";

const empty: PlaygroundValue = {
  question: "",
  language: "auto",
  answer: null,
  notes: "",
  panel: "terminal",
  view: "playground",
  explanation: null,
  explanations: [],
  mockInterview: null,
};
const answer = {
  title: "Two sum",
  language: "typescript" as const,
  answerMarkdown: "Use a map.",
  code: "export function twoSum() {}",
  usageCode: "",
  testCode: "it('works')",
};
const snapshot = (
  revision: number,
  value: Partial<PlaygroundValue>,
): PlaygroundSnapshot => ({
  revision,
  updatedAt: `2026-10-01T10:00:0${revision}.000Z`,
  value: { ...empty, ...value },
});
let next = 0;
const newArtifact = () => `q-${++next}`;

beforeEach(() => {
  next = 0;
});

describe("playground control plan", () => {
  it("ignores the empty store and pushes already applied", () => {
    expect(isNewSnapshot(snapshot(0, {}), null)).toBe(false);
    const pushed = snapshot(1, { question: "Two sum?" });
    expect(isNewSnapshot(pushed, null)).toBe(true);
    const plan = planControl(pushed, null, newArtifact);
    expect(isNewSnapshot(pushed, plan.applied)).toBe(false);
    // A restarted server counts again from 1, at a different time.
    expect(
      isNewSnapshot(
        { ...pushed, updatedAt: "2026-10-02T00:00:00Z" },
        plan.applied,
      ),
    ).toBe(true);
  });

  it("opens a new question as a new draft and updates it in place", () => {
    const first = planControl(
      snapshot(1, { question: " Two sum? ", notes: "map", answer }),
      null,
      newArtifact,
    );
    expect(first.write).toEqual({
      artifact: "q-1",
      created: true,
      draft: { question: "Two sum?", notes: "map", answer },
    });
    expect(first.navigate).toEqual({ view: "work", artifact: "q-1" });

    // The same question with a refined answer updates the same draft.
    const refined = planControl(
      snapshot(2, {
        question: "Two sum?",
        notes: "map",
        answer: { ...answer, code: "// better" },
      }),
      first.applied,
      newArtifact,
    );
    expect(refined.write).toMatchObject({ artifact: "q-1", created: false });

    // An unrelated patch (the panel) leaves the draft alone.
    const panelOnly = planControl(
      snapshot(3, {
        question: "Two sum?",
        notes: "map",
        answer: { ...answer, code: "// better" },
        panel: "notes",
      }),
      refined.applied,
      newArtifact,
    );
    expect(panelOnly.write).toBeNull();
    expect(panelOnly.navigate).toEqual({ view: "work", artifact: "q-1" });

    // A different question is a new draft.
    const other = planControl(
      snapshot(4, { question: "LRU cache?" }),
      panelOnly.applied,
      newArtifact,
    );
    expect(other.write).toMatchObject({ artifact: "q-2", created: true });
  });

  it("titles an answer pushed without a question, and skips empty pushes", () => {
    expect(draftOf(snapshot(1, { answer }))?.question).toBe("Two sum");
    expect(draftOf(snapshot(1, { notes: "only notes" }))).toBeNull();
    const plan = planControl(
      snapshot(1, { panel: "notes" }),
      null,
      newArtifact,
    );
    expect(plan.write).toBeNull();
    // Nothing to show (a reset, or only a panel): stay where you are.
    expect(plan.navigate).toBeNull();
    expect(
      planControl(snapshot(1, { view: "mock-interview" }), null, newArtifact)
        .navigate,
    ).toEqual({ view: "rehearsal" });
  });

  it("maps views, explanations and rehearsal commands", () => {
    const explanation = { title: "Closures", topic: "JS", markdown: "# Hi" };
    const concept = snapshot(1, {
      view: "concept-lab",
      explanation,
      explanations: undefined as never,
    });
    expect(explanationsOf(concept)).toEqual([explanation]);
    expect(planControl(concept, null, newArtifact).navigate).toEqual({
      view: "briefings",
      rest: ["explanations"],
    });
    expect(
      planControl(
        snapshot(1, { view: "interview-preparation" }),
        null,
        newArtifact,
      ).navigate,
    ).toEqual({ view: "briefings" });
    expect(
      explanationsOf(snapshot(1, { explanations: undefined as never })),
    ).toEqual([]);

    const start = planControl(
      snapshot(2, {
        view: "mock-interview",
        mockInterview: { action: "start", strict: true },
      }),
      null,
      newArtifact,
    );
    expect(start.navigate).toEqual({ view: "rehearsal" });
    expect(start.rehearsal).toMatchObject({ action: "start", strict: true });
    // The same command carried by a later patch is not run again.
    const again = planControl(
      snapshot(3, {
        view: "mock-interview",
        mockInterview: { action: "start", strict: true },
        panel: "notes",
      }),
      start.applied,
      newArtifact,
    );
    expect(again.rehearsal).toBeNull();
  });
});

describe("playground control storage and writes", () => {
  it("remembers what was applied, and survives missing storage", () => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (name: string) => values.get(name) ?? null,
        setItem: (name: string, value: string) => values.set(name, value),
      },
    });
    expect(readApplied()).toBeNull();
    const applied = {
      key: "1@t",
      draft: null,
      question: null,
      artifact: null,
      rehearsal: null,
    };
    storeApplied(applied);
    expect(readApplied()).toEqual(applied);

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      },
    });
    expect(readApplied()).toBeNull();
    expect(() => storeApplied(applied)).not.toThrow();
  });

  it("writes a draft at the revision it read, and reports failures", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          method: init?.method ?? "GET",
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return Response.json({ origin: { artifactRevision: 3 } });
      }),
    );
    const draft = { question: "Q", notes: "", answer: null };
    await writeControlDraft("interview", "q 1", draft);
    expect(calls).toEqual([
      {
        method: "GET",
        url: "/api/interview/workspaces/interview/artifacts/q%201",
        body: undefined,
      },
      {
        method: "PATCH",
        url: "/api/interview/workspaces/interview/artifacts/q%201",
        body: { origin: { artifactRevision: 3 }, patch: draft },
      },
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    await expect(writeControlDraft("interview", "q", draft)).rejects.toThrow(
      "500",
    );
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reads++ === 0
          ? Response.json({ origin: {} })
          : new Response("", { status: 400 }),
      ),
    );
    await expect(writeControlDraft("interview", "q", draft)).rejects.toThrow(
      "400",
    );
    vi.unstubAllGlobals();
  });
});
