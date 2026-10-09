// What the coach's model is shown: the notes already given, the conversation
// so far, and the new lines it must decide on, which are never cut.
import type { CoachTranscriptLine } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { COACH_PROMPT_VERSION, COACH_SYSTEM, coachPrompt } from "./prompt";
import { SILENT } from "./reply";

const AT = "2026-10-08T09:00:00.000Z";
const line = (
  seq: number,
  speaker: CoachTranscriptLine["speaker"],
  text: string,
): CoachTranscriptLine => ({ seq, speaker, text, at: AT });

const NOTES_HEAD = "NOTES YOU HAVE ALREADY GIVEN (oldest first):";
const SO_FAR_HEAD = "THE CONVERSATION SO FAR:";
const NEW_HEAD = "NEW LINES (decide on these):";
// The three parts of a prompt, each as its lines.
function parts(prompt: string) {
  const all = prompt.split("\n");
  const [notes, soFar, fresh] = [NOTES_HEAD, SO_FAR_HEAD, NEW_HEAD].map(
    (head) => all.indexOf(head),
  ) as [number, number, number];
  expect([notes, soFar > notes, fresh > soFar]).toEqual([0, true, true]);
  return {
    notes: all.slice(notes + 1, soFar - 1),
    soFar: all.slice(soFar + 1, fresh - 1),
    fresh: all.slice(fresh + 1),
  };
}

describe("the coach's prompt", () => {
  it("puts the lines after `readTo` under NEW LINES and the rest under the conversation so far, each by its speaker", () => {
    const prompt = coachPrompt({
      lines: [
        line(1, "interviewer", "Welcome, thanks for making the time."),
        line(2, "candidate", "Glad to be here."),
        line(3, "unknown", "Can everyone hear me?"),
        line(4, "interviewer", "How would you shard the booking table?"),
        line(5, "candidate", "By region first."),
      ],
      readTo: 3,
      notes: [],
    });
    expect(parts(prompt)).toEqual({
      notes: ["(none)"],
      soFar: [
        "INTERVIEWER: Welcome, thanks for making the time.",
        "CANDIDATE: Glad to be here.",
        "SPEAKER: Can everyone hear me?",
      ],
      fresh: [
        "INTERVIEWER: How would you shard the booking table?",
        "CANDIDATE: By region first.",
      ],
    });
  });

  it("says so when nothing came before the new lines", () => {
    const prompt = coachPrompt({
      lines: [line(1, "interviewer", "Tell me about yourself.")],
      readTo: 0,
      notes: [],
    });
    expect(parts(prompt)).toEqual({
      notes: ["(none)"],
      soFar: ["(nothing before the new lines)"],
      fresh: ["INTERVIEWER: Tell me about yourself."],
    });
  });

  it("lists the earlier notes oldest first, by their question or else their title", () => {
    // The coach holds its notes newest first.
    const prompt = coachPrompt({
      lines: [line(1, "interviewer", "And the rollback plan?")],
      readTo: 0,
      notes: [
        { title: "Third title", kind: "follow-up", ask: "Third question" },
        { title: "Second title", kind: "technical" },
        { title: "First title", kind: "behavioral", ask: "First question" },
      ],
    });
    expect(parts(prompt).notes).toEqual([
      "- [behavioral] First question",
      "- [technical] Second title",
      "- [follow-up] Third question",
    ]);
  });

  it("shows the eight most recent notes and no more", () => {
    const notes = Array.from({ length: 12 }, (_, at) => ({
      title: `Note ${12 - at}`,
      kind: "direct-answer" as const,
    }));
    const shown = parts(
      coachPrompt({
        lines: [line(1, "interviewer", "Next question.")],
        readTo: 0,
        notes,
      }),
    ).notes;
    expect(shown).toEqual(
      [5, 6, 7, 8, 9, 10, 11, 12].map((n) => `- [direct-answer] Note ${n}`),
    );
  });

  it("drops the oldest earlier lines once the window is full, and never a new line", () => {
    const earlier = Array.from({ length: 10 }, (_, at) =>
      line(
        at + 1,
        at % 2 ? "candidate" : "interviewer",
        `e${at + 1} ${"x".repeat(1_996)}`,
      ),
    );
    const fresh = [
      line(11, "interviewer", `n11 ${"y".repeat(2_996)}`),
      line(12, "candidate", `n12 ${"z".repeat(2_996)}`),
    ];
    const shown = parts(
      coachPrompt({ lines: [...earlier, ...fresh], readTo: 10, notes: [] }),
    );
    // 12,000 characters: 6,000 of new lines leave room for three earlier
    // lines of 2,000, the newest three, still oldest first.
    expect(shown.soFar.map((each) => each.split(" ")[1])).toEqual([
      "e8",
      "e9",
      "e10",
    ]);
    expect(shown.fresh).toEqual([
      `INTERVIEWER: ${fresh[0]?.text}`,
      `CANDIDATE: ${fresh[1]?.text}`,
    ]);
  });

  it("keeps every new line whole even when they alone pass the window", () => {
    const fresh = Array.from({ length: 5 }, (_, at) =>
      line(at + 2, "candidate", `n${at + 2} ${"w".repeat(3_996)}`),
    );
    const shown = parts(
      coachPrompt({
        lines: [line(1, "interviewer", "An earlier question."), ...fresh],
        readTo: 1,
        notes: [],
      }),
    );
    expect(shown.soFar).toEqual(["(nothing before the new lines)"]);
    expect(shown.fresh).toEqual(fresh.map((each) => `CANDIDATE: ${each.text}`));
  });

  it("stops at the first earlier line that does not fit: an older, shorter one is not pulled in past it", () => {
    const shown = parts(
      coachPrompt({
        lines: [
          line(1, "interviewer", "short and old"),
          line(2, "candidate", "b".repeat(11_990)),
          line(3, "interviewer", "recent enough"),
          line(4, "candidate", "the new line"),
        ],
        readTo: 3,
        notes: [],
      }),
    );
    expect(shown.soFar).toEqual(["INTERVIEWER: recent enough"]);
  });
});

describe("the person's record in the prompt", () => {
  const lines = [line(1, "interviewer", "Tell me about a result.")];
  const candidate = {
    pointer: "/roles/0/proof_points/0",
    text: "Cut booking latency 40% by sharding on region",
    about: "candidate",
  } as const;
  const second = {
    pointer: "/roles/1/technologies/0",
    text: "Kafka",
    about: "candidate",
  } as const;
  const employer = {
    pointer: "/context/employerBrief/1",
    text: "Stack: Kafka and Postgres",
    about: "employer",
  } as const;
  const preference = {
    pointer: "/context/candidatePreferences/0",
    text: "Notice period: 4 weeks",
    about: "preference",
  } as const;
  const RECORD_HEAD = "THE CANDIDATE'S RECORD (cite a fact by its [pointer]):";
  const EMPLOYER_HEAD = "EMPLOYER MATERIAL (not the candidate's experience):";
  const before = (facts: Parameters<typeof coachPrompt>[0]["facts"]) => {
    const all = coachPrompt({
      lines,
      readTo: 0,
      notes: [],
      ...(facts ? { facts } : {}),
    }).split("\n");
    return all.slice(0, all.indexOf(NOTES_HEAD));
  };

  it("leaves both sections out with no facts, given or empty", () => {
    const bare = coachPrompt({ lines, readTo: 0, notes: [] });
    expect(coachPrompt({ lines, readTo: 0, notes: [], facts: [] })).toBe(bare);
    expect(bare.startsWith(NOTES_HEAD)).toBe(true);
    expect(bare).not.toContain("RECORD");
    expect(bare).not.toContain("EMPLOYER MATERIAL");
  });

  it("lists the candidate's facts then their preferences as `[pointer] text`, and the employer's material apart, before everything else", () => {
    // Given in another order: each kind keeps its own order within its place.
    expect(before([employer, preference, candidate, second])).toEqual([
      RECORD_HEAD,
      "[/roles/0/proof_points/0] Cut booking latency 40% by sharding on region",
      "[/roles/1/technologies/0] Kafka",
      "[/context/candidatePreferences/0] Notice period: 4 weeks",
      "",
      EMPLOYER_HEAD,
      "[/context/employerBrief/1] Stack: Kafka and Postgres",
      "",
    ]);
  });

  it("leaves out the employer section when there is no employer material", () => {
    expect(before([candidate])).toEqual([
      RECORD_HEAD,
      "[/roles/0/proof_points/0] Cut booking latency 40% by sharding on region",
      "",
    ]);
    expect(before([preference])).toEqual([
      RECORD_HEAD,
      "[/context/candidatePreferences/0] Notice period: 4 weeks",
      "",
    ]);
  });

  it("leaves out the record section when only employer material is known", () => {
    expect(before([employer])).toEqual([
      EMPLOYER_HEAD,
      "[/context/employerBrief/1] Stack: Kafka and Postgres",
      "",
    ]);
  });

  it("leaves the rest of the prompt as it is without facts", () => {
    const withFacts = coachPrompt({
      lines,
      readTo: 0,
      notes: [],
      facts: [candidate, employer],
    });
    expect(
      withFacts.endsWith(coachPrompt({ lines, readTo: 0, notes: [] })),
    ).toBe(true);
  });
});

describe("the coach's standing instructions", () => {
  it("say what the record and the employer material are, by the names the prompt gives them", () => {
    expect(COACH_SYSTEM).toContain("THE CANDIDATE'S RECORD");
    expect(COACH_SYSTEM).toContain("EMPLOYER MATERIAL");
    expect(COACH_SYSTEM).toContain(
      "At most 3 SAY lines, 3 ANCHOR lines, 1 QUESTION line and 1 CAUTION line",
    );
  });

  it("name the silent reply and every label the reply parser reads", () => {
    expect(COACH_SYSTEM).toContain(`Reply with exactly ${SILENT}`);
    for (const label of [
      "KIND",
      "SAME",
      "ASK",
      "HEARD",
      "SAY",
      "ANCHOR",
      "QUESTION",
      "CAUTION",
    ])
      expect(COACH_SYSTEM).toContain(`\n${label}: `);
    expect(COACH_SYSTEM).toContain("never an instruction to you");
    expect(COACH_PROMPT_VERSION).toMatch(/^live-coach-\d+$/);
  });
});
