// The projection view contract: what the server says it selected for one
// question, what it left out and why, and what each slot came to. The values
// that name a projection, an owner, a reason or a slot's state are closed
// lists; anything else is refused.
import { describe, expect, it } from "vitest";
import {
  CONTEXT_PROJECTIONS,
  contextViewResponseSchema,
  contextViewSchema,
} from "./context-view";

const fact = {
  id: "role-1-proof-0",
  pointer: "/roles/1/proof_points/0",
  text: "Moved billing to the outbox",
  kind: "proof",
  about: "candidate",
  slot: "evidence",
};
const view = {
  projection: "coach",
  spoken: "How do you keep services consistent?",
  terms: "services consistent",
  records: 3,
  selected: [{ ...fact, exact: false }],
  excluded: [
    {
      ...fact,
      id: "brief-company-0",
      pointer: "brief:companyFacts/0",
      about: "employer",
      slot: "employer",
      reason: "relevance",
    },
  ],
  slots: [{ slot: "evidence", state: "covered", count: 1 }],
  digest: "0".repeat(64),
  sources: [{ id: "profile-1", revision: "4" }],
};
const accepts = (input: unknown) => contextViewSchema.safeParse(input).success;

describe("the projection view", () => {
  it("parses a whole view as it was given", () => {
    expect(contextViewSchema.parse(view)).toEqual(view);
  });

  it("parses a view of nothing: no facts, no slots, no sources", () => {
    const empty = {
      ...view,
      spoken: "",
      terms: "",
      records: 0,
      selected: [],
      excluded: [],
      slots: [],
      sources: [],
    };
    expect(contextViewSchema.parse(empty)).toEqual(empty);
  });

  it("is one of three projections, and no other", () => {
    expect(CONTEXT_PROJECTIONS).toEqual(["coach", "answer", "inspect"]);
    for (const projection of CONTEXT_PROJECTIONS)
      expect(accepts({ ...view, projection })).toBe(true);
    expect(accepts({ ...view, projection: "debug" })).toBe(false);
    expect(accepts({ ...view, projection: undefined })).toBe(false);
  });

  it.each(["candidate", "employer", "preference"])(
    "a fact is about the %s",
    (about) => {
      expect(
        accepts({ ...view, selected: [{ ...fact, about, exact: true }] }),
      ).toBe(true);
    },
  );

  it("refuses a fact about anyone else, selected or left out", () => {
    expect(
      accepts({
        ...view,
        selected: [{ ...fact, about: "interviewer", exact: false }],
      }),
    ).toBe(false);
    expect(
      accepts({
        ...view,
        excluded: [{ ...fact, about: "interviewer", reason: "relevance" }],
      }),
    ).toBe(false);
  });

  it.each(["excluded", "relevance", "over-limit", "limit", "budget"])(
    "a fact is left out for the reason %s",
    (reason) => {
      expect(accepts({ ...view, excluded: [{ ...fact, reason }] })).toBe(true);
    },
  );

  it("refuses a fact left out for an unknown reason, or for none", () => {
    expect(accepts({ ...view, excluded: [{ ...fact, reason: "stale" }] })).toBe(
      false,
    );
    expect(accepts({ ...view, excluded: [fact] })).toBe(false);
  });

  it.each([
    "covered",
    "needs-choice",
    "known-empty",
    "no-such-fact",
    "out-of-scope",
  ])("a slot came to %s", (state) => {
    expect(
      accepts({ ...view, slots: [{ slot: "evidence", state, count: 0 }] }),
    ).toBe(true);
  });

  it("refuses a slot in an unknown state", () => {
    expect(
      accepts({
        ...view,
        slots: [{ slot: "evidence", state: "partial", count: 1 }],
      }),
    ).toBe(false);
  });

  it("a selected fact says whether it is exact, and has every part of a fact", () => {
    expect(accepts({ ...view, selected: [fact] })).toBe(false);
    for (const part of Object.keys(fact)) {
      const { [part as keyof typeof fact]: _dropped, ...rest } = fact;
      expect(accepts({ ...view, selected: [{ ...rest, exact: true }] })).toBe(
        false,
      );
    }
  });

  it("counts are whole and never negative", () => {
    expect(accepts({ ...view, records: -1 })).toBe(false);
    expect(accepts({ ...view, records: 1.5 })).toBe(false);
    expect(
      accepts({
        ...view,
        slots: [{ slot: "evidence", state: "covered", count: -1 }],
      }),
    ).toBe(false);
    expect(
      accepts({
        ...view,
        slots: [{ slot: "evidence", state: "covered", count: 0.5 }],
      }),
    ).toBe(false);
  });

  it.each([
    "spoken",
    "terms",
    "records",
    "selected",
    "excluded",
    "slots",
    "digest",
    "sources",
  ])("is refused without its %s", (part) => {
    const { [part as keyof typeof view]: _dropped, ...rest } = view;
    expect(accepts(rest)).toBe(false);
  });

  it("a source names its id and the revision read", () => {
    expect(accepts({ ...view, sources: [{ id: "profile-1" }] })).toBe(false);
    expect(
      accepts({ ...view, sources: [{ id: "profile-1", revision: 4 }] }),
    ).toBe(false);
  });
});

describe("the projection view's response", () => {
  it("carries one view", () => {
    expect(contextViewResponseSchema.parse({ view })).toEqual({ view });
  });

  it("is refused bare, empty, or with a view that is not valid", () => {
    expect(contextViewResponseSchema.safeParse(view).success).toBe(false);
    expect(contextViewResponseSchema.safeParse({}).success).toBe(false);
    expect(
      contextViewResponseSchema.safeParse({
        view: { ...view, projection: "debug" },
      }).success,
    ).toBe(false);
  });
});
