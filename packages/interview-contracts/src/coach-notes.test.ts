// The coach note contract: what a coach may post to the live window, and the
// bounds that keep a note short enough to read while speaking.
import { describe, expect, it } from "vitest";
import {
  COACH_NOTE_KINDS,
  coachNoteInputSchema,
  coachNoteLinkSchema,
  coachNoteSchema,
  coachNoteSectionSchema,
  coachNoteSteerSchema,
  coachNotesResponseSchema,
  TALKING_POINT_LENGTH,
} from "./coach-notes";

const accepts = (input: unknown) =>
  coachNoteInputSchema.safeParse(input).success;
const stored = {
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-10-08T17:40:00.000Z",
  title: "Consistency",
  tone: "say",
  points: [],
  links: [],
};

describe("a coach note's links", () => {
  it("accepts an https address", () => {
    expect(
      coachNoteLinkSchema.parse({
        label: "  Outbox pattern ",
        url: "https://example.com/outbox",
      }),
    ).toEqual({ label: "Outbox pattern", url: "https://example.com/outbox" });
  });

  it.each([
    ["plain http", "http://example.com/outbox"],
    ["a script address", "javascript:alert(1)"],
    ["a file address", "file:///etc/hosts"],
    ["a data address", "data:text/html,hello"],
    ["a relative path", "/docs/outbox"],
    ["no address at all", "outbox"],
  ])("refuses %s", (_name, url) => {
    expect(coachNoteLinkSchema.safeParse({ label: "Docs", url }).success).toBe(
      false,
    );
  });

  it("bounds the label (1 to 80 characters) and the address (600)", () => {
    const link = (label: string, url = "https://example.com/") =>
      coachNoteLinkSchema.safeParse({ label, url }).success;
    expect(link("   ")).toBe(false);
    expect(link("a".repeat(80))).toBe(true);
    expect(link("a".repeat(81))).toBe(false);
    const address = (length: number) =>
      `https://example.com/${"a".repeat(length - "https://example.com/".length)}`;
    expect(link("Docs", address(600))).toBe(true);
    expect(link("Docs", address(601))).toBe(false);
  });

  it("refuses a key it does not know", () => {
    expect(
      coachNoteLinkSchema.safeParse({
        label: "Docs",
        url: "https://example.com/",
        target: "_blank",
      }).success,
    ).toBe(false);
  });
});

describe("a coach note as posted", () => {
  it("needs only a title: it is a note to say, with no points and no links", () => {
    expect(
      coachNoteInputSchema.parse({ title: " Monolith or service " }),
    ).toEqual({
      title: "Monolith or service",
      tone: "say",
      kind: "answer",
      points: [],
      sections: [],
      links: [],
    });
  });

  it("is a note to say or one to watch, nothing else", () => {
    expect(accepts({ title: "Pace", tone: "watch" })).toBe(true);
    expect(accepts({ title: "Pace", tone: "shout" })).toBe(false);
  });

  it("bounds the title to 1 to 120 characters", () => {
    expect(accepts({})).toBe(false);
    expect(accepts({ title: "  " })).toBe(false);
    expect(accepts({ title: "a".repeat(120) })).toBe(true);
    expect(accepts({ title: "a".repeat(121) })).toBe(false);
  });

  it("takes up to six points of up to 280 characters, none of them blank", () => {
    const points = (list: string[]) => accepts({ title: "T", points: list });
    expect(points(Array(6).fill("Name the criteria"))).toBe(true);
    expect(points(Array(7).fill("Name the criteria"))).toBe(false);
    expect(points(["a".repeat(280)])).toBe(true);
    expect(points(["a".repeat(281)])).toBe(false);
    expect(points(["  "])).toBe(false);
  });

  it("takes Markdown of up to 6,000 characters, never an empty one", () => {
    const markdown = (text: string) => accepts({ title: "T", markdown: text });
    expect(markdown("## Say\n- **outbox**")).toBe(true);
    expect(markdown("a".repeat(6_000))).toBe(true);
    expect(markdown("a".repeat(6_001))).toBe(false);
    expect(markdown("   ")).toBe(false);
  });

  it("takes up to five links, each of them https", () => {
    const link = (at: number) => ({
      label: `Docs ${at}`,
      url: `https://example.com/${at}`,
    });
    const links = (count: number) =>
      accepts({
        title: "T",
        links: Array.from({ length: count }, (_, at) => link(at)),
      });
    expect(links(5)).toBe(true);
    expect(links(6)).toBe(false);
    expect(
      accepts({
        title: "T",
        links: [link(1), { label: "Plain", url: "http://example.com/" }],
      }),
    ).toBe(false);
  });

  it("may restate the question in up to 80 characters, never a blank one", () => {
    const ask = (text: unknown) => accepts({ title: "T", ask: text });
    expect(ask("Data consistency across services")).toBe(true);
    expect(ask("a".repeat(80))).toBe(true);
    expect(ask("a".repeat(81))).toBe(false);
    expect(ask("")).toBe(false);
    expect(ask("   ")).toBe(false);
    expect(ask(7)).toBe(false);
    expect(ask(null)).toBe(false);
  });

  it("may name its question with an id of up to 64 characters, never a blank one", () => {
    const askId = (id: unknown) => accepts({ title: "T", askId: id });
    expect(askId("q-consistency")).toBe(true);
    expect(askId("a".repeat(64))).toBe(true);
    expect(askId("a".repeat(65))).toBe(false);
    expect(askId("")).toBe(false);
    expect(askId("   ")).toBe(false);
    expect(askId(3)).toBe(false);
  });

  it("trims the restatement and the id, and measures them trimmed", () => {
    expect(
      coachNoteInputSchema.parse({
        title: "T",
        ask: "  Data consistency  ",
        askId: " q-consistency ",
      }),
    ).toMatchObject({ ask: "Data consistency", askId: "q-consistency" });
    expect(accepts({ title: "T", ask: ` ${"a".repeat(80)} ` })).toBe(true);
    expect(accepts({ title: "T", askId: ` ${"a".repeat(64)} ` })).toBe(true);
  });

  it("leaves the restatement and the id out when they are not given", () => {
    const parsed = coachNoteInputSchema.parse({ title: "T" });
    expect(parsed).not.toHaveProperty("ask");
    expect(parsed).not.toHaveProperty("askId");
  });

  it("may say when the note was for, as an ISO time in UTC", () => {
    const at = (value: unknown) => accepts({ title: "T", at: value });
    expect(at("2026-10-08T17:40:00.000Z")).toBe(true);
    expect(at("2026-10-08T17:40:00Z")).toBe(true);
    expect(at("yesterday")).toBe(false);
    expect(at("2026-10-08")).toBe(false);
    expect(at("2026-10-08T17:40:00")).toBe(false);
    expect(at("2026-10-08T17:40:00+02:00")).toBe(false);
    expect(at("")).toBe(false);
    expect(at(1_791_481_200_000)).toBe(false);
    expect(at(null)).toBe(false);
    expect(
      coachNoteInputSchema.parse({ title: "T", at: "2026-10-08T17:40:00Z" }),
    ).toMatchObject({ at: "2026-10-08T17:40:00Z" });
  });

  it("leaves the time out when it is not given: the note is for now", () => {
    expect(coachNoteInputSchema.parse({ title: "T" })).not.toHaveProperty("at");
  });

  it("refuses a key it does not know, so a coach cannot set the id or the time", () => {
    expect(accepts({ title: "T", id: stored.id })).toBe(false);
    expect(accepts({ title: "T", createdAt: stored.createdAt })).toBe(false);
    expect(accepts({ title: "T", html: "<b>bold</b>" })).toBe(false);
  });
});

describe("a structured coach note", () => {
  const atMost = "a".repeat(TALKING_POINT_LENGTH);
  const tooLong = "a".repeat(TALKING_POINT_LENGTH + 1);

  it("a talking point is one sentence's worth: up to 240 characters", () => {
    expect(TALKING_POINT_LENGTH).toBe(240);
  });

  it("is one of five kinds, an answer unless it says otherwise", () => {
    expect(COACH_NOTE_KINDS).toEqual([
      "answer",
      "follow-up",
      "steer",
      "ask-them",
      "close",
    ]);
    for (const kind of COACH_NOTE_KINDS)
      expect(coachNoteInputSchema.parse({ title: "T", kind }).kind).toBe(kind);
    expect(coachNoteInputSchema.parse({ title: "T" }).kind).toBe("answer");
    expect(accepts({ title: "T", kind: "aside" })).toBe(false);
    expect(accepts({ title: "T", kind: null })).toBe(false);
  });

  it("a section is a label of up to 24 characters over one to five talking points", () => {
    const section = (input: unknown) =>
      coachNoteSectionSchema.safeParse(input).success;
    expect(
      coachNoteSectionSchema.parse({ label: " Say ", points: [" Lead "] }),
    ).toEqual({ label: "Say", points: ["Lead"] });
    expect(section({ label: "a".repeat(24), points: ["P"] })).toBe(true);
    expect(section({ label: "a".repeat(25), points: ["P"] })).toBe(false);
    expect(section({ label: "  ", points: ["P"] })).toBe(false);
    expect(section({ label: "Say", points: [] })).toBe(false);
    expect(section({ label: "Say", points: Array(5).fill("P") })).toBe(true);
    expect(section({ label: "Say", points: Array(6).fill("P") })).toBe(false);
    expect(section({ label: "Say", points: [atMost] })).toBe(true);
    expect(section({ label: "Say", points: [tooLong] })).toBe(false);
    expect(section({ label: "Say", points: ["  "] })).toBe(false);
    expect(section({ label: "Say" })).toBe(false);
    expect(section({ label: "Say", points: ["P"], tone: "say" })).toBe(false);
  });

  it("takes up to four sections, and has none unless given", () => {
    const sections = (count: number) =>
      accepts({
        title: "T",
        sections: Array.from({ length: count }, (_, at) => ({
          label: `Group ${at}`,
          points: ["P"],
        })),
      });
    expect(sections(4)).toBe(true);
    expect(sections(5)).toBe(false);
    expect(coachNoteInputSchema.parse({ title: "T" }).sections).toEqual([]);
    expect(
      accepts({ title: "T", sections: [{ label: "Say", points: [] }] }),
    ).toBe(false);
  });

  it("a steer says what is off, and may give the line back; each is a talking point", () => {
    const steer = (input: unknown) =>
      coachNoteSteerSchema.safeParse(input).success;
    expect(
      coachNoteSteerSchema.parse({
        issue: " Reads only ",
        say: " For writes ",
      }),
    ).toEqual({ issue: "Reads only", say: "For writes" });
    expect(steer({ issue: "Reads only" })).toBe(true);
    expect(steer({ say: "For writes" })).toBe(false);
    expect(steer({ issue: "  " })).toBe(false);
    expect(steer({ issue: atMost, say: atMost })).toBe(true);
    expect(steer({ issue: tooLong })).toBe(false);
    expect(steer({ issue: "Reads only", say: tooLong })).toBe(false);
    expect(steer({ issue: "Reads only", say: "" })).toBe(false);
    expect(steer({ issue: "Reads only", tone: "watch" })).toBe(false);
    expect(accepts({ title: "T", steer: { issue: "Reads only" } })).toBe(true);
    expect(accepts({ title: "T", steer: {} })).toBe(false);
  });

  it("may say what was heard (600), what is wanted (a talking point) and a diagram (1,500), none of them blank", () => {
    const field = (name: string, value: unknown) =>
      accepts({ title: "T", [name]: value });
    expect(field("heard", "a".repeat(600))).toBe(true);
    expect(field("heard", "a".repeat(601))).toBe(false);
    expect(field("heard", "  ")).toBe(false);
    expect(field("wants", atMost)).toBe(true);
    expect(field("wants", tooLong)).toBe(false);
    expect(field("wants", "")).toBe(false);
    expect(field("diagram", "a".repeat(1_500))).toBe(true);
    expect(field("diagram", "a".repeat(1_501))).toBe(false);
    expect(field("diagram", "   ")).toBe(false);
    expect(
      coachNoteInputSchema.parse({
        title: "T",
        heard: " How would you split it ",
        wants: " A rule ",
        diagram: " flowchart LR ",
      }),
    ).toMatchObject({
      heard: "How would you split it",
      wants: "A rule",
      diagram: "flowchart LR",
    });
  });

  it("leaves what was not given out, and is kept as it was posted", () => {
    const parsed = coachNoteInputSchema.parse({ title: "T" });
    for (const key of ["heard", "wants", "steer", "diagram"])
      expect(parsed).not.toHaveProperty(key);
    const kept = {
      ...stored,
      kind: "steer",
      heard: "How would you split it",
      wants: "A rule",
      sections: [{ label: "Say", points: ["Lead with the result"] }],
      steer: { issue: "Reads only", say: "For writes" },
      diagram: "flowchart LR",
    };
    expect(coachNoteSchema.parse(kept)).toEqual(kept);
  });

  it("a note kept before notes had a structure still reads: an answer with no sections", () => {
    expect(coachNoteSchema.parse(stored)).toMatchObject({
      kind: "answer",
      sections: [],
    });
  });
});

describe("a coach note as kept", () => {
  it("carries a uuid and an ISO time", () => {
    expect(coachNoteSchema.safeParse(stored).success).toBe(true);
    expect(coachNoteSchema.safeParse({ ...stored, id: "note-1" }).success).toBe(
      false,
    );
    expect(
      coachNoteSchema.safeParse({ ...stored, createdAt: "yesterday" }).success,
    ).toBe(false);
  });

  it("has one time, createdAt: the moment it was posted for is not kept beside it", () => {
    expect(
      coachNoteSchema.safeParse({ ...stored, at: "2026-10-08T17:40:00.000Z" })
        .success,
    ).toBe(false);
    expect(
      coachNotesResponseSchema.safeParse({
        revision: 1,
        notes: [{ ...stored, at: "2026-10-08T17:40:00.000Z" }],
      }).success,
    ).toBe(false);
  });

  it("keeps the restatement and the id it was posted with, within the same bounds", () => {
    const kept = { ...stored, ask: "Data consistency", askId: "q-consistency" };
    expect(coachNoteSchema.parse(kept)).toMatchObject({
      ask: "Data consistency",
      askId: "q-consistency",
    });
    expect(
      coachNoteSchema.safeParse({ ...stored, ask: "a".repeat(81) }).success,
    ).toBe(false);
    expect(
      coachNoteSchema.safeParse({ ...stored, askId: "a".repeat(65) }).success,
    ).toBe(false);
    expect(
      coachNotesResponseSchema.safeParse({ revision: 2, notes: [kept] })
        .success,
    ).toBe(true);
  });

  it("is listed with a revision that is a whole number from 0", () => {
    const response = (revision: number) =>
      coachNotesResponseSchema.safeParse({ revision, notes: [stored] }).success;
    expect(response(0)).toBe(true);
    expect(response(7)).toBe(true);
    expect(response(-1)).toBe(false);
    expect(response(1.5)).toBe(false);
    expect(
      coachNotesResponseSchema.safeParse({
        revision: 1,
        notes: [],
        extra: true,
      }).success,
    ).toBe(false);
  });
});
