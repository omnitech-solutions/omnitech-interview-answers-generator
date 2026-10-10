// The interview brief's contract: what a stage, a transcript, an
// employer-said entry and a research document may hold, every size bounded
// here, and the carry-over of the briefing form's old texts.
import { describe, expect, it } from "vitest";
import {
  briefingContextSchema,
  briefingEmployerSaid,
  briefingResearchDocuments,
  employerSaidText,
} from "./briefing";
import {
  employerSaidInputSchema,
  employerSaidLine,
  employerSaidUpdateSchema,
  INTERVIEW_BRIEF_BOUNDS,
  interviewBriefSchema,
  mayLeaveDevice,
  researchCreateSchema,
  researchUpdateSchema,
  stageCreateSchema,
  stageOrderSchema,
  stageTranscriptSchema,
  stageUpdateSchema,
  transcriptAttachSchema,
  transcriptPasteSchema,
  transcriptUpdateSchema,
} from "./interview-brief";

const ok =
  (schema: { safeParse(input: unknown): { success: boolean } }) =>
  (input: unknown) =>
    schema.safeParse(input).success;
const ID = "22222222-2222-4222-8222-222222222222";
const AT = "2026-11-03T17:30:00.000Z";

describe("what may leave this machine", () => {
  it("is everything but what was taken under a device-only policy", () => {
    expect(mayLeaveDevice({ capturePolicy: "device-only" })).toBe(false);
    expect(mayLeaveDevice({ capturePolicy: "permitted-remote" })).toBe(true);
    expect(mayLeaveDevice({ capturePolicy: null })).toBe(true);
    expect(mayLeaveDevice({})).toBe(true);
  });
});

describe("a stage", () => {
  it("is made with a kind and a name, and nothing else", () => {
    const accepts = ok(stageCreateSchema);
    expect(accepts({ kind: "technical", label: "Technical" })).toBe(true);
    expect(
      stageCreateSchema.parse({ kind: "final", label: "  Final " }),
    ).toEqual({ kind: "final", label: "Final" });
    expect(accepts({ kind: "coffee", label: "Chat" })).toBe(false);
    expect(accepts({ kind: "technical", label: " " })).toBe(false);
    expect(
      accepts({
        kind: "technical",
        label: "x".repeat(INTERVIEW_BRIEF_BOUNDS.labelChars + 1),
      }),
    ).toBe(false);
    expect(accepts({ kind: "technical", label: "T", ordinal: 1 })).toBe(false);
  });

  it("is updated field by field, each within its bound", () => {
    const accepts = ok(stageUpdateSchema);
    expect(accepts({})).toBe(true);
    expect(
      accepts({
        label: "Technical",
        kind: "technical",
        scheduledAt: AT,
        durationMinutes: 120,
        format: "onsite",
        status: "completed",
        notes: "n",
        outcome: "o",
        nextSteps: "s",
        people: [
          { name: "Dana Whitlow", title: "Head", role: "hiring_manager" },
        ],
      }),
    ).toBe(true);
    // Null clears what may be empty.
    expect(
      accepts({
        scheduledAt: null,
        durationMinutes: null,
        format: null,
        notes: null,
        outcome: null,
        nextSteps: null,
      }),
    ).toBe(true);
    for (const bad of [
      { durationMinutes: 4 },
      { durationMinutes: 481 },
      { durationMinutes: 30.5 },
      { scheduledAt: "tomorrow" },
      { scheduledAt: "2026-11-03" },
      { format: "hologram" },
      { status: "done" },
      { label: "" },
      { notes: "x".repeat(INTERVIEW_BRIEF_BOUNDS.notesChars + 1) },
      { outcome: "x".repeat(INTERVIEW_BRIEF_BOUNDS.outcomeChars + 1) },
      { nextSteps: "x".repeat(INTERVIEW_BRIEF_BOUNDS.nextStepsChars + 1) },
      { people: [{ name: " " }] },
      { people: [{ name: "x".repeat(INTERVIEW_BRIEF_BOUNDS.nameChars + 1) }] },
      // The candidate is the member, never listed.
      { people: [{ name: "Me", role: "candidate" }] },
      { people: [{ name: "Dana", email: "d@example.invalid" }] },
      {
        people: Array.from(
          { length: INTERVIEW_BRIEF_BOUNDS.peoplePerStage + 1 },
          (_, at) => ({ name: `Person ${at}` }),
        ),
      },
      { candidacyId: ID },
    ])
      expect(accepts(bad), JSON.stringify(bad).slice(0, 60)).toBe(false);
  });

  it("is ordered by every stage's id", () => {
    const accepts = ok(stageOrderSchema);
    expect(accepts({ order: [ID] })).toBe(true);
    expect(accepts({ order: [] })).toBe(false);
    expect(accepts({ order: ["first"] })).toBe(false);
    expect(
      accepts({
        order: Array.from(
          { length: INTERVIEW_BRIEF_BOUNDS.stages + 1 },
          () => ID,
        ),
      }),
    ).toBe(false);
  });
});

describe("a transcript", () => {
  it("is pasted as text within a generous, stated bound", () => {
    const accepts = ok(transcriptPasteSchema);
    expect(INTERVIEW_BRIEF_BOUNDS.transcriptChars).toBe(1_000_000);
    expect(INTERVIEW_BRIEF_BOUNDS.transcriptUploadBytes).toBe(4 * 1024 * 1024);
    expect(accepts({ text: "Dana: hello" })).toBe(true);
    expect(
      accepts({ text: "a".repeat(INTERVIEW_BRIEF_BOUNDS.transcriptChars) }),
    ).toBe(true);
    expect(
      accepts({ text: "a".repeat(INTERVIEW_BRIEF_BOUNDS.transcriptChars + 1) }),
    ).toBe(false);
    expect(accepts({ text: "" })).toBe(false);
    expect(accepts({ text: " \n\t" })).toBe(false);
    expect(
      accepts({
        text: "x",
        title: "Call",
        occurredAt: AT,
        capturePolicy: "device-only",
      }),
    ).toBe(true);
    expect(accepts({ text: "x", capturePolicy: "anywhere" })).toBe(false);
    expect(accepts({ text: "x", origin: "recorded" })).toBe(false);
    // What was pasted is kept exactly: not trimmed.
    expect(transcriptPasteSchema.parse({ text: " A: hi \n" }).text).toBe(
      " A: hi \n",
    );
  });

  it("is attached from the Studio's recordings only by a recording's own file name", () => {
    const accepts = ok(transcriptAttachSchema);
    expect(accepts({ file: "2026-11-03T17-39-54-120-abcdef12.txt" })).toBe(
      true,
    );
    for (const file of [
      "../2026-11-03T17-39-54-120-abcdef12.txt",
      "2026-11-03T17-39-54-120-abcdef12.txt/../x",
      "/etc/passwd",
      "notes.txt",
      "2026-11-03T17-39-54-120-ABCDEF12.txt",
      "2026-11-03T17-39-54-120-abcdef12.vtt",
      "",
    ])
      expect(accepts({ file }), file).toBe(false);
  });

  it("changes only its title, its date and its policy", () => {
    const accepts = ok(transcriptUpdateSchema);
    expect(accepts({ title: "Call", occurredAt: null })).toBe(true);
    expect(accepts({ capturePolicy: "permitted-remote" })).toBe(true);
    expect(accepts({ text: "rewritten" })).toBe(false);
    expect(accepts({ origin: "pasted" })).toBe(false);
  });

  it("is listed without its words, saying whether it may be sent", () => {
    const listed = {
      id: ID,
      stageId: ID,
      title: "Call",
      origin: "recorded",
      originName: "2026-11-03T17-39-54-120-abcdef12.txt",
      capturePolicy: "device-only",
      sendable: false,
      occurredAt: null,
      chars: 10,
      turns: 2,
      sha256: "a".repeat(64),
      createdAt: AT,
      updatedAt: AT,
    };
    expect(stageTranscriptSchema.parse(listed)).toEqual(listed);
    expect(
      Object.keys(stageTranscriptSchema.parse({ ...listed, text: "words" })),
    ).not.toContain("text");
    expect(ok(stageTranscriptSchema)({ ...listed, sha256: "abc" })).toBe(false);
  });
});

describe("what the employer said", () => {
  it("is what was said, with who, how and when where known", () => {
    const accepts = ok(employerSaidInputSchema);
    expect(accepts({ said: "Two rounds." })).toBe(true);
    expect(
      accepts({
        said: "Two rounds.",
        saidBy: "Sam",
        channel: "call",
        saidOn: "2026-10-02",
      }),
    ).toBe(true);
    for (const bad of [
      { said: "" },
      { said: "  " },
      { said: "x".repeat(INTERVIEW_BRIEF_BOUNDS.employerSaidChars + 1) },
      { said: "x", channel: "fax" },
      { said: "x", saidOn: "02/10/2026" },
      { said: "x", saidOn: AT },
      { said: "x", saidBy: " " },
      { said: "x", stage: 1 },
    ])
      expect(accepts(bad), JSON.stringify(bad).slice(0, 60)).toBe(false);
    // An update may clear who, how and when, never what was said.
    expect(
      ok(employerSaidUpdateSchema)({
        saidBy: null,
        channel: null,
        saidOn: null,
      }),
    ).toBe(true);
    expect(ok(employerSaidUpdateSchema)({ said: " " })).toBe(false);
  });

  it("reads as one line: when, who and how lead what was said", () => {
    expect(employerSaidLine({ said: " Two rounds. " })).toBe("Two rounds.");
    expect(
      employerSaidLine({
        said: "Two rounds.",
        saidBy: "Sam",
        channel: "email",
        saidOn: "2026-10-02",
      }),
    ).toBe("2026-10-02, Sam (email): Two rounds.");
    expect(employerSaidLine({ said: "x", channel: "call" })).toBe("(call): x");
    expect(employerSaidLine({ said: "x", saidOn: "2026-10-02" })).toBe(
      "2026-10-02: x",
    );
    expect(employerSaidLine({ said: "x", saidBy: null, saidOn: null })).toBe(
      "x",
    );
  });
});

describe("a research document", () => {
  it("is a title and text, and a link's text says where it is from", () => {
    const accepts = ok(researchCreateSchema);
    expect(accepts({ title: "Overview", text: "They sell forecasts." })).toBe(
      true,
    );
    expect(
      accepts({
        title: "Blog",
        text: "x",
        origin: "url",
        originRef: "https://example.invalid/a",
        scope: "company",
      }),
    ).toBe(true);
    for (const bad of [
      { title: "", text: "x" },
      { title: "T", text: " " },
      {
        title: "T",
        text: "x".repeat(INTERVIEW_BRIEF_BOUNDS.researchChars + 1),
      },
      { title: "T", text: "x", origin: "url" },
      { title: "T", text: "x", originRef: "not a link" },
      // A file comes through the upload route, never as a claim in JSON.
      { title: "T", text: "x", origin: "file" },
      { title: "T", text: "x", scope: "world" },
    ])
      expect(accepts(bad), JSON.stringify(bad).slice(0, 60)).toBe(false);
    expect(ok(researchUpdateSchema)({ title: "New" })).toBe(true);
    expect(ok(researchUpdateSchema)({ origin: "url" })).toBe(false);
  });
});

describe("the brief as it is read", () => {
  it("is the application, its stages, what the employer said and its research", () => {
    const brief = {
      candidacyId: ID,
      companyName: "Larkspur Analytics",
      title: "Principal Engineer",
      applicationNotes: null,
      stages: [
        {
          id: ID,
          ordinal: 1,
          kind: "technical",
          label: "Technical",
          scheduledAt: AT,
          durationMinutes: 60,
          format: "video",
          status: "scheduled",
          notes: null,
          offeredNotes: "Old notes",
          outcome: null,
          nextSteps: null,
          people: [{ id: ID, name: "Dana", title: null, role: "interviewer" }],
          transcripts: [],
        },
      ],
      employerSaid: [
        {
          id: ID,
          said: "Two rounds.",
          saidBy: null,
          channel: null,
          saidOn: null,
          sha256: "a".repeat(64),
          createdAt: AT,
          updatedAt: AT,
        },
      ],
      research: [
        {
          id: "carried-company-research",
          scope: "company",
          title: "Company research",
          origin: "pasted",
          originRef: null,
          chars: 10,
          sha256: "b".repeat(64),
          carried: true,
          createdAt: null,
          updatedAt: null,
        },
      ],
    };
    expect(interviewBriefSchema.parse(brief)).toEqual(brief);
    expect(
      ok(interviewBriefSchema)({
        ...brief,
        stages: [{ ...brief.stages[0], ordinal: 0 }],
      }),
    ).toBe(false);
  });
});

describe("the briefing form's old texts", () => {
  const context = {
    company: "Northwind",
    role: "Tech Lead",
    stage: "recruiter",
    profile: { id: "profile", revision: 1 },
  };

  it("reads the old employer notes as one entry with no date, and the entries when there are any", () => {
    expect(briefingEmployerSaid({})).toEqual([]);
    expect(briefingEmployerSaid({ employerNotes: "  " })).toEqual([]);
    expect(briefingEmployerSaid({ employerNotes: "Two rounds." })).toEqual([
      { said: "Two rounds." },
    ]);
    // The list, once there is one, is what was said: even an empty one.
    expect(
      briefingEmployerSaid({
        employerNotes: "Two rounds.",
        employerSaid: [{ said: "Three rounds.", saidOn: "2026-10-02" }],
      }),
    ).toEqual([{ said: "Three rounds.", saidOn: "2026-10-02" }]);
    expect(
      briefingEmployerSaid({ employerNotes: "x", employerSaid: [] }),
    ).toEqual([]);
  });

  it("writes one carried-over entry back as exactly the text it came from", () => {
    const old = "Two rounds.\nNo AI in live ones.";
    expect(employerSaidText(briefingEmployerSaid({ employerNotes: old }))).toBe(
      old,
    );
    expect(employerSaidText([])).toBe("");
  });

  it("reads the research text as one document", () => {
    expect(briefingResearchDocuments({})).toEqual([]);
    expect(briefingResearchDocuments({ research: "Founded 2019." })).toEqual([
      { title: "Research", text: "Founded 2019." },
    ]);
  });

  it("keeps a pack with the old text alone, with the entries, or with both", () => {
    const accepts = ok(briefingContextSchema);
    expect(accepts({ ...context, employerNotes: "Two rounds." })).toBe(true);
    expect(
      accepts({
        ...context,
        employerSaid: [{ said: "Two rounds.", channel: "email" }],
        employerNotes: "(email): Two rounds.",
      }),
    ).toBe(true);
    expect(accepts({ ...context, employerSaid: [{ said: "" }] })).toBe(false);
    expect(
      accepts({
        ...context,
        employerSaid: Array.from({ length: 41 }, () => ({ said: "x" })),
      }),
    ).toBe(false);
  });
});
