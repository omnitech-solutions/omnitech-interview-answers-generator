// Shared SYNTHETIC replay fixtures for the Active Session processor (E-A1).
// Everything here is invented and anonymised: speakers are source labels
// (never verified identities), there are no real names, employers, contacts or
// compensation figures, and session-replay-fixtures.test.ts scans for that.
// The recruiter-screen script has the structure of a real call: split and
// timestamped utterances, backchannels interleaved with a monologue, filler, a
// compound question, a "part two" follow-up, a deferred topic and an ASR
// correction that supersedes an earlier segment.
export type FixtureSegment = {
  eventId: string;
  // "interviewer" arrives on the application-audio source, "candidate" on the
  // microphone; the labels are not verified identities.
  role: "interviewer" | "candidate";
  startMs: number;
  endMs: number;
  text: string;
  supersedes?: string;
};

export const FIXTURE_SOURCES = {
  interviewer: { sourceId: "application-audio", speaker: "speaker-1" },
  candidate: { sourceId: "microphone", speaker: "speaker-2" },
} as const;

export type ReplayPhase = {
  name: string;
  segments: readonly FixtureSegment[];
};

const seg = (
  eventId: string,
  role: FixtureSegment["role"],
  startMs: number,
  text: string,
  supersedes?: string,
): FixtureSegment => ({
  eventId,
  role,
  startMs,
  endMs: startMs + 2_000,
  text,
  ...(supersedes === undefined ? {} : { supersedes }),
});

// Placeholder-only vocabulary: the only names a fixture may use.
export const FIXTURE_PLACEHOLDERS = {
  people: ["Interviewer", "Candidate"],
  companies: ["Example Corp"],
} as const;

export const RECRUITER_SCREEN: readonly ReplayPhase[] = [
  {
    name: "opening, monologue with backchannels, then the first question",
    segments: [
      seg("s01", "interviewer", 0, "Thanks for making the time today."),
      seg("s02", "candidate", 3_000, "Happy to be here."),
      seg(
        "s03",
        "interviewer",
        6_000,
        "So a little context on the team. We are a mid sized group building internal tooling for several product lines, and over the last year we have moved most of our services onto a shared platform with common deployment pipelines, a shared observability stack, and a small set of agreed conventions for how services talk to each other.",
      ),
      seg("s04", "candidate", 20_000, "mm-hm"),
      seg(
        "s05",
        "interviewer",
        22_000,
        "The role would sit between the platform group and a few of the product teams, helping each of them adopt the shared tooling and feeding back what is missing.",
      ),
      seg("s06", "candidate", 34_000, "Right."),
      seg(
        "s08",
        "candidate",
        36_000,
        "Sounds good, that fits what I have been looking for.",
      ),
      seg(
        "s09",
        "interviewer",
        40_000,
        "Tell me about a time you led a migration to a new service, and what trade-offs did you weigh along the way?",
      ),
    ],
  },
  {
    name: "filler and a long answer, then the part-two follow-up",
    segments: [
      seg("s10", "candidate", 46_000, "Um, uh,"),
      seg(
        "s11",
        "candidate",
        48_000,
        "so in one case we moved a batch job over to a queue based worker, and the main trade off was between a simpler cutover and keeping the old path alive for a while. We chose to keep both paths running side by side for two weeks, watched the error rates and the queue depth every day, and only then retired the old path once the numbers had stayed flat.",
      ),
      seg(
        "s12",
        "interviewer",
        80_000,
        "Part two of that, how did you handle rollback when the cutover failed?",
      ),
    ],
  },
  {
    name: "a deferred topic, then a second question",
    segments: [
      seg(
        "s13",
        "candidate",
        90_000,
        "We kept a tested switch to flip the traffic back, so a rollback took minutes rather than hours.",
      ),
      seg(
        "s14",
        "interviewer",
        100_000,
        "Compensation is a topic we can circle back to later.",
      ),
      seg("s15", "candidate", 104_000, "Sure, that works for me."),
      seg(
        "s16",
        "interviewer",
        108_000,
        "What is your experience with distributed trading?",
      ),
    ],
  },
  {
    name: "an ASR correction that supersedes the earlier segment",
    segments: [
      seg(
        "s17",
        "interviewer",
        108_000,
        "What is your experience with distributed tracing?",
        "s16",
      ),
    ],
  },
];

// Every string a fixture carries that the privacy scan must read.
export const allFixtureTexts = (): string[] =>
  RECRUITER_SCREEN.flatMap((phase) => [
    phase.name,
    ...phase.segments.map((segment) => segment.text),
  ]);

// The canned, closed-schema model output the fake gateway returns.
export const CANNED_DRAFT = {
  draft:
    "Open with the situation, name the two or three trade-offs, then close with what was measured afterwards.",
  sections: [
    {
      kind: "general-knowledge",
      text: "A staged cutover with both paths live trades extra cost for a safe rollback.",
    },
  ],
} as const;
