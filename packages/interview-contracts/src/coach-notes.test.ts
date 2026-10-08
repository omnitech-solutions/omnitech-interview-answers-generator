// The coach note contract: what a coach may post to the live window, and the
// bounds that keep a note short enough to read while speaking.
import { describe, expect, it } from "vitest";
import {
  COACH_NOTE_KINDS,
  COACH_ROLES,
  COACH_SECTION_KINDS,
  coachLineSchema,
  coachNoteInputSchema,
  coachNoteLinkSchema,
  coachNoteSchema,
  coachNoteSectionSchema,
  coachNotesResponseSchema,
  coachSegmentSchema,
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
const line = (text: string) => ({ segments: [{ text }] });

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
      kind: "direct-answer",
      points: [],
      sections: [],
      links: [],
      revision: 1,
      status: "ready",
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

describe("a piece of a line", () => {
  const segment = (input: unknown) =>
    coachSegmentSchema.safeParse(input).success;

  it("a talking point is one sentence's worth: up to 240 characters", () => {
    expect(TALKING_POINT_LENGTH).toBe(240);
  });

  it("is spoken unless it says otherwise, and has one of four roles", () => {
    expect(COACH_ROLES).toEqual(["spoken", "evidence", "caution", "context"]);
    expect(coachSegmentSchema.parse({ text: "We moved it" })).toEqual({
      text: "We moved it",
      role: "spoken",
    });
    for (const role of COACH_ROLES)
      expect(coachSegmentSchema.parse({ text: "T", role }).role).toBe(role);
    expect(segment({ text: "T", role: "bold" })).toBe(false);
    expect(segment({ text: "T", role: null })).toBe(false);
  });

  it("keeps its text as written: the spaces that join it to its neighbours are not trimmed", () => {
    expect(coachSegmentSchema.parse({ text: " at " }).text).toBe(" at ");
    // A space alone is a piece: it is what stands between two others.
    expect(coachSegmentSchema.parse({ text: " " }).text).toBe(" ");
    expect(coachSegmentSchema.parse({ text: "ends here \n" }).text).toBe(
      "ends here \n",
    );
  });

  it("bounds its text to 1 to 240 characters, counted as written", () => {
    expect(segment({ text: "" })).toBe(false);
    expect(segment({})).toBe(false);
    expect(segment({ text: 7 })).toBe(false);
    expect(segment({ text: "a".repeat(TALKING_POINT_LENGTH) })).toBe(true);
    expect(segment({ text: "a".repeat(TALKING_POINT_LENGTH + 1) })).toBe(false);
    // Not trimmed, so the spaces count toward the length.
    expect(segment({ text: ` ${"a".repeat(TALKING_POINT_LENGTH)}` })).toBe(
      false,
    );
  });

  it("may say whether its claim is verified or inferred, and nothing else", () => {
    expect(
      coachSegmentSchema.parse({
        text: "Acme",
        role: "evidence",
        grounding: "verified",
      }),
    ).toEqual({ text: "Acme", role: "evidence", grounding: "verified" });
    expect(segment({ text: "Acme", grounding: "inferred" })).toBe(true);
    expect(segment({ text: "Acme", grounding: "guessed" })).toBe(false);
    expect(segment({ text: "Acme", grounding: null })).toBe(false);
    expect(coachSegmentSchema.parse({ text: "Acme" })).not.toHaveProperty(
      "grounding",
    );
  });

  it("refuses a key it does not know", () => {
    expect(segment({ text: "Acme", bold: true })).toBe(false);
  });
});

describe("a line", () => {
  const accepted = (input: unknown) => coachLineSchema.safeParse(input).success;
  const pieces = (count: number, text = "a") => ({
    segments: Array.from({ length: count }, () => ({ text })),
  });

  it("is one to twelve pieces, each given its default role", () => {
    expect(coachLineSchema.parse(line("Lead with the result"))).toEqual({
      segments: [{ text: "Lead with the result", role: "spoken" }],
    });
    expect(accepted({ segments: [] })).toBe(false);
    expect(accepted({})).toBe(false);
    expect(accepted(pieces(12))).toBe(true);
    expect(accepted(pieces(13))).toBe(false);
  });

  it("is one sentence: its pieces together are at most 240 characters", () => {
    expect(accepted(pieces(2, "a".repeat(120)))).toBe(true);
    expect(
      accepted({
        segments: [{ text: "a".repeat(120) }, { text: "a".repeat(121) }],
      }),
    ).toBe(false);
    expect(accepted(pieces(12, "a".repeat(20)))).toBe(true);
    expect(accepted(pieces(12, "a".repeat(21)))).toBe(false);
    // The joining spaces are part of the sentence, so they count.
    expect(
      accepted({
        segments: [
          { text: "a".repeat(120) },
          { text: " " },
          { text: "a".repeat(120) },
        ],
      }),
    ).toBe(false);
  });

  it("says why a line that is too long was refused", () => {
    const read = coachLineSchema.safeParse(pieces(2, "a".repeat(121)));
    expect(read.success).toBe(false);
    expect(read.error?.issues.map((issue) => issue.message)).toEqual([
      "A line is one sentence: too long.",
    ]);
  });

  it("refuses a bad piece and a key it does not know", () => {
    expect(accepted({ segments: [{ text: "" }] })).toBe(false);
    expect(accepted({ segments: [{ text: "T", role: "bold" }] })).toBe(false);
    expect(accepted({ segments: [{ text: "T" }], kind: "say" })).toBe(false);
    expect(accepted({ segments: ["T"] })).toBe(false);
  });
});

describe("a section", () => {
  const section = (input: unknown) =>
    coachNoteSectionSchema.safeParse(input).success;

  it("is one of five kinds, and must say which", () => {
    expect(COACH_SECTION_KINDS).toEqual([
      "say",
      "anchors",
      "ask",
      "caution",
      "context",
    ]);
    for (const kind of COACH_SECTION_KINDS)
      expect(
        coachNoteSectionSchema.parse({ kind, lines: [line("P")] }),
      ).toEqual({
        kind,
        lines: [{ segments: [{ text: "P", role: "spoken" }] }],
      });
    expect(section({ lines: [line("P")] })).toBe(false);
    expect(section({ kind: "steer", lines: [line("P")] })).toBe(false);
  });

  it("may carry a heading of its own of up to 24 characters, trimmed, never blank", () => {
    expect(
      coachNoteSectionSchema.parse({
        kind: "say",
        label: " If pushed ",
        lines: [line("P")],
      }).label,
    ).toBe("If pushed");
    const labelled = (label: unknown) =>
      section({ kind: "say", label, lines: [line("P")] });
    expect(labelled("a".repeat(24))).toBe(true);
    expect(labelled(` ${"a".repeat(24)} `)).toBe(true);
    expect(labelled("a".repeat(25))).toBe(false);
    expect(labelled("  ")).toBe(false);
    expect(labelled("")).toBe(false);
    expect(
      coachNoteSectionSchema.parse({ kind: "say", lines: [line("P")] }),
    ).not.toHaveProperty("label");
  });

  it("holds one to five lines", () => {
    const lines = (count: number) =>
      section({ kind: "say", lines: Array(count).fill(line("P")) });
    expect(lines(0)).toBe(false);
    expect(lines(1)).toBe(true);
    expect(lines(5)).toBe(true);
    expect(lines(6)).toBe(false);
    expect(section({ kind: "say" })).toBe(false);
  });

  it("refuses a line that is too long, the earlier shape of labelled points, and a key it does not know", () => {
    expect(
      section({
        kind: "say",
        lines: [line("P"), line("a".repeat(TALKING_POINT_LENGTH + 1))],
      }),
    ).toBe(false);
    expect(section({ label: "Say", points: ["Lead"] })).toBe(false);
    expect(section({ kind: "say", lines: [line("P")], points: ["P"] })).toBe(
      false,
    );
    expect(section({ kind: "say", lines: ["P"] })).toBe(false);
  });
});

describe("a structured coach note", () => {
  it("is one of six kinds, a direct answer unless it says otherwise", () => {
    expect(COACH_NOTE_KINDS).toEqual([
      "direct-answer",
      "technical",
      "behavioral",
      "closing",
      "follow-up",
      "missed-opportunity",
    ]);
    for (const kind of COACH_NOTE_KINDS)
      expect(coachNoteInputSchema.parse({ title: "T", kind }).kind).toBe(kind);
    expect(coachNoteInputSchema.parse({ title: "T" }).kind).toBe(
      "direct-answer",
    );
    for (const earlier of ["answer", "steer", "ask-them", "close", null])
      expect(accepts({ title: "T", kind: earlier })).toBe(false);
  });

  it("takes up to four sections, and has none unless given", () => {
    const sections = (count: number) =>
      accepts({
        title: "T",
        sections: Array.from({ length: count }, () => ({
          kind: "say",
          lines: [line("P")],
        })),
      });
    expect(sections(4)).toBe(true);
    expect(sections(5)).toBe(false);
    expect(coachNoteInputSchema.parse({ title: "T" }).sections).toEqual([]);
    expect(
      accepts({ title: "T", sections: [{ kind: "say", lines: [] }] }),
    ).toBe(false);
  });

  it("gives every piece of every line its default role", () => {
    expect(
      coachNoteInputSchema.parse({
        title: "T",
        sections: [
          {
            kind: "anchors",
            lines: [
              {
                segments: [
                  { text: "At " },
                  { text: "Acme", role: "evidence", grounding: "inferred" },
                ],
              },
            ],
          },
        ],
      }).sections,
    ).toEqual([
      {
        kind: "anchors",
        lines: [
          {
            segments: [
              { text: "At ", role: "spoken" },
              { text: "Acme", role: "evidence", grounding: "inferred" },
            ],
          },
        ],
      },
    ]);
  });

  it("no longer takes what is wanted or a steer: a caution section says it", () => {
    expect(accepts({ title: "T", wants: "A rule" })).toBe(false);
    expect(accepts({ title: "T", steer: { issue: "Reads only" } })).toBe(false);
  });

  it("may say what was heard (600) and a diagram (1,500), trimmed, neither of them blank", () => {
    const field = (name: string, value: unknown) =>
      accepts({ title: "T", [name]: value });
    expect(field("heard", "a".repeat(600))).toBe(true);
    expect(field("heard", "a".repeat(601))).toBe(false);
    expect(field("heard", "  ")).toBe(false);
    expect(field("diagram", "a".repeat(1_500))).toBe(true);
    expect(field("diagram", "a".repeat(1_501))).toBe(false);
    expect(field("diagram", "   ")).toBe(false);
    expect(
      coachNoteInputSchema.parse({
        title: "T",
        heard: " How would you split it ",
        diagram: " flowchart LR ",
      }),
    ).toMatchObject({
      heard: "How would you split it",
      diagram: "flowchart LR",
    });
  });

  it("may be one note over time: a key of up to 64 characters, trimmed, never blank", () => {
    const key = (value: unknown) => accepts({ title: "T", key: value });
    expect(key("q-consistency")).toBe(true);
    expect(key("a".repeat(64))).toBe(true);
    expect(key(` ${"a".repeat(64)} `)).toBe(true);
    expect(key("a".repeat(65))).toBe(false);
    expect(key("")).toBe(false);
    expect(key("   ")).toBe(false);
    expect(key(3)).toBe(false);
    expect(coachNoteInputSchema.parse({ title: "T", key: " q-1 " }).key).toBe(
      "q-1",
    );
  });

  it("its revision is a whole number from 1, and 1 unless given", () => {
    const revision = (value: unknown) =>
      accepts({ title: "T", revision: value });
    expect(coachNoteInputSchema.parse({ title: "T" }).revision).toBe(1);
    expect(
      coachNoteInputSchema.parse({ title: "T", revision: 7 }).revision,
    ).toBe(7);
    expect(revision(1)).toBe(true);
    expect(revision(0)).toBe(false);
    expect(revision(-1)).toBe(false);
    expect(revision(1.5)).toBe(false);
    expect(revision("2")).toBe(false);
    expect(revision(null)).toBe(false);
  });

  it("is being prepared or ready, and ready unless it says otherwise", () => {
    expect(coachNoteInputSchema.parse({ title: "T" }).status).toBe("ready");
    expect(
      coachNoteInputSchema.parse({ title: "T", status: "pending" }).status,
    ).toBe("pending");
    expect(accepts({ title: "T", status: "done" })).toBe(false);
    expect(accepts({ title: "T", status: null })).toBe(false);
  });

  it("leaves what was not given out, and is kept as it was posted", () => {
    const parsed = coachNoteInputSchema.parse({ title: "T" });
    for (const key of ["heard", "diagram", "key", "markdown"])
      expect(parsed).not.toHaveProperty(key);
    const kept = {
      ...stored,
      kind: "follow-up",
      heard: "How would you split it",
      sections: [
        {
          kind: "say",
          label: "If pushed",
          lines: [
            {
              segments: [
                { text: "Lead with ", role: "spoken" },
                { text: "the result", role: "evidence", grounding: "verified" },
              ],
            },
          ],
        },
      ],
      diagram: "flowchart LR",
      key: "q-1",
      revision: 3,
      status: "pending",
    };
    expect(coachNoteSchema.parse(kept)).toEqual(kept);
  });

  it("a note kept before notes had a structure still reads: a ready direct answer at revision 1, with no sections", () => {
    expect(coachNoteSchema.parse(stored)).toMatchObject({
      kind: "direct-answer",
      sections: [],
      revision: 1,
      status: "ready",
    });
  });

  it("a kept note in an earlier shape (labelled points, a steer, an earlier kind) is not this contract's: the store reads those", () => {
    const kept = (extra: object) =>
      coachNoteSchema.safeParse({ ...stored, ...extra }).success;
    expect(kept({ sections: [{ label: "Say", points: ["Lead"] }] })).toBe(
      false,
    );
    expect(kept({ steer: { issue: "Reads only" } })).toBe(false);
    expect(kept({ wants: "A rule" })).toBe(false);
    expect(kept({ kind: "answer" })).toBe(false);
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
