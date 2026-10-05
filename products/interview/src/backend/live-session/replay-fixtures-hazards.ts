// SYNTHETIC grounding-hazard and transcript-shape fixtures (E-A1). Invented
// and anonymised: only the placeholders Interviewer, Candidate and Example
// Corp, no real employer, no contact detail, no currency or compensation
// amount in any spoken text (a notice-period or compensation QUESTION is fine).
//
// Each set records what the baseline policy (interview-policy.ts
// decideBaseline) really produces for its text, as `expect`; the fixture test
// re-derives those facts so the description cannot drift from the policy.
// Segments alternate speakers so consecutive same-speaker lines never coalesce
// two questions into one utterance by accident.
import { ABSENT_FRAMEWORK } from "./replay-fixture-matrix";
import {
  candidate,
  createScript,
  interviewer,
  type ReplayPhase,
} from "./session-replay-fixtures";

type ReplayExpect = {
  // One line saying what the set shows.
  description: string;
  // Hazard label from the workload profile, when the set is a grounding hazard.
  hazard?: "7a" | "7b" | "7c" | "7d";
  // Logical tasks the baseline policy opens.
  opensTasks: number;
  // Final revision of each opened task, in opening order.
  revisions: readonly number[];
  // Topics left deferred in task state.
  deferredTopics: number;
  // Segments that are backchannel, filler or monologue and must open no task.
  inertEventIds: readonly string[];
  // The candidate segment carrying the hazardous statement, if any.
  hazardEventId?: string;
};

export type ReplayFixtureSet = {
  phases: readonly ReplayPhase[];
  expect: ReplayExpect;
};

// ---- 7a: the candidate affirms a framework the approved matrix lacks -------
const h7a = createScript("h7a");
const unsupportedFramework: ReplayFixtureSet = {
  phases: [
    h7a.phase("the interviewer asks about a framework absent from the matrix", [
      interviewer(
        `Do you have recent hands-on experience with ${ABSENT_FRAMEWORK}?`,
      ),
      candidate(
        `Yes, I used ${ABSENT_FRAMEWORK} in the last two or three projects.`,
        { label: "affirm" },
      ),
      interviewer("Okay."),
    ]),
  ],
  expect: {
    description:
      "one question opens one task; the affirmation opens or revises nothing",
    hazard: "7a",
    opensTasks: 1,
    revisions: [1],
    deferredTopics: 0,
    inertEventIds: ["h7a003"],
    hazardEventId: "h7a002",
  },
};

// ---- 7b: a metric stated aloud that is not in the matrix -------------------
const h7b = createScript("h7b");
const unsupportedMetric: ReplayFixtureSet = {
  phases: [
    h7b.phase("a project story question, the candidate states a figure aloud", [
      interviewer(
        "Tell me about a project where you improved performance, and what result did you measure?",
      ),
      candidate(
        "We cut the processing cost by 70 percent and the nightly job went from 3 hours to 10 minutes.",
      ),
      interviewer("Right."),
    ]),
  ],
  expect: {
    description:
      "one question opens one task; the spoken figures are not in the matrix",
    hazard: "7b",
    opensTasks: 1,
    revisions: [1],
    deferredTopics: 0,
    inertEventIds: ["h7b003"],
    hazardEventId: "h7b002",
  },
};

// ---- 7c: why did you leave the current job and a previous one --------------
const h7c = createScript("h7c");
const leavingRoles: ReplayFixtureSet = {
  phases: [
    h7c.phase(
      "why the candidate is leaving the current role and a previous one",
      [
        interviewer(
          "Why are you leaving your current role, and why did you leave the one before it?",
        ),
        candidate(
          "Honestly my last manager and I did not see eye to eye, and the team before that was a mess.",
        ),
        interviewer("I see."),
      ],
    ),
  ],
  expect: {
    description:
      "a compound leaving-role question is one task; the disparaging answer opens nothing",
    hazard: "7c",
    opensTasks: 1,
    revisions: [1],
    deferredTopics: 0,
    inertEventIds: ["h7c003"],
    hazardEventId: "h7c002",
  },
};

// ---- 7d: notice period and compensation expectations -----------------------
const h7d = createScript("h7d");
const logistics: ReplayFixtureSet = {
  phases: [
    h7d.phase("notice period question", [
      interviewer("What is your notice period?"),
      candidate("I would need two weeks."),
    ]),
    h7d.phase("compensation expectation question", [
      interviewer("And what are your compensation expectations?"),
      candidate("I would rather discuss that after the technical stages."),
    ]),
  ],
  expect: {
    description:
      "two logistics questions open two tasks; figures may only come from approved preferences",
    hazard: "7d",
    opensTasks: 2,
    revisions: [1, 1],
    deferredTopics: 0,
    inertEventIds: [],
    hazardEventId: "h7d004",
  },
};

// ---- backchannel and monologue only ---------------------------------------
const bm = createScript("bm");
const backchannelAndMonologueOnly: ReplayFixtureSet = {
  phases: [
    bm.phase("a long role description with interleaved backchannels", [
      interviewer(
        "Let me describe the role in some detail. The team is a mid sized group that builds internal tooling for several product lines, and over the last year most of its services have moved onto a shared platform with common deployment pipelines and a shared observability stack.",
      ),
      candidate("mm-hm"),
      interviewer(
        "Day to day the work is a mix of feature delivery and platform adoption. Roughly half the time goes on building new capabilities with the product teams, and the other half goes on helping each team adopt the shared tooling and feeding back what is missing from it.",
      ),
      candidate("Right."),
      interviewer(
        "The group meets for a short planning session at the start of every cycle, then a review at the end of it, and in between engineers pair on the harder changes, keep their pull requests small, and rely on the shared pipeline to catch regressions before anything is released.",
      ),
      candidate("Yeah."),
      interviewer(
        "There is an on call rotation shared across the platform group, with a written runbook for each service, a blameless review after every incident, and a standing agreement that nobody carries the pager for more than one week in any four week stretch.",
      ),
      candidate("Okay."),
      interviewer(
        "Over the next year the plan is to retire the last of the older batch jobs, consolidate the remaining services onto the shared platform, and give every product team a small set of dashboards that show how their services are behaving in production.",
      ),
      candidate("Got it."),
      interviewer(
        "Career growth works through a written ladder with clear expectations at each level, regular conversations with a manager, and a budget for learning that engineers are encouraged to actually use during the year.",
      ),
      candidate("uh huh"),
    ]),
  ],
  expect: {
    description:
      "a role-description monologue with backchannels opens no task and revises none",
    opensTasks: 0,
    revisions: [],
    deferredTopics: 0,
    inertEventIds: [
      "bm001",
      "bm002",
      "bm003",
      "bm004",
      "bm005",
      "bm006",
      "bm007",
      "bm008",
      "bm009",
      "bm010",
      "bm011",
      "bm012",
    ],
  },
};

// ---- compound question with a part-two follow-up ---------------------------
const cq = createScript("cq");
const compoundWithPartTwo: ReplayFixtureSet = {
  phases: [
    cq.phase("a compound question, then the part-two follow-up", [
      interviewer(
        "Tell me about a time you chose between two designs, and who did you involve in that decision?",
      ),
      candidate(
        "We had two options for the order service, a staged cutover and a single big switch, and I wrote a short comparison, asked two senior engineers and the product owner to review it, and we picked the staged cutover because rollback stayed cheap and the risk was spread over several small steps.",
      ),
      interviewer(
        "Part two of that, what would you change if you did it again?",
      ),
    ]),
  ],
  expect: {
    description:
      "the compound question is one task; part two raises it to revision 2",
    opensTasks: 1,
    revisions: [2],
    deferredTopics: 0,
    inertEventIds: ["cq002"],
  },
};

// ---- deferred topic -------------------------------------------------------
const dt = createScript("dt");
const deferredTopic: ReplayFixtureSet = {
  phases: [
    dt.phase("a topic is put aside, then a question", [
      interviewer(
        "Let us put a pin in team structure and come back to it after the technical questions.",
      ),
      candidate("Sure, that works for me."),
      interviewer("Why do you want this role?"),
      candidate(
        "The platform adoption work is close to what I enjoy most, helping teams move onto shared tooling.",
      ),
    ]),
  ],
  expect: {
    description:
      "the put-aside topic stays deferred in task state and opens no task; the later question opens one",
    opensTasks: 1,
    revisions: [1],
    deferredTopics: 1,
    inertEventIds: [],
  },
};

// ---- ASR errors and corrections -------------------------------------------
const asr = createScript("asr");
const asrErrorAndCorrection: ReplayFixtureSet = {
  phases: [
    asr.phase("a package audit command heard as other words, then corrected", [
      interviewer("Do you run and PM audit in your delivery pipeline?", {
        label: "audit",
      }),
      candidate("Yes, on every build before anything is merged."),
      interviewer("Do you run npm audit in your delivery pipeline?", {
        supersedes: "audit",
      }),
    ]),
    asr.phase("a product name heard as a place name, then corrected", [
      candidate("That is right, it gates the release."),
      interviewer("Have you operated cuba in production for event streaming?", {
        label: "stream",
      }),
      candidate("A little, mostly for audit events."),
      interviewer(
        "Have you operated kafka in production for event streaming?",
        {
          supersedes: "stream",
        },
      ),
    ]),
    asr.phase("a framework name split in two, then corrected", [
      candidate("Yes, that is the one I meant."),
      interviewer(
        "Have you built services with nest j s and a document database?",
        {
          label: "framework",
        },
      ),
      candidate("I have built services on Node, yes."),
      interviewer(
        "Have you built services with nest js and a document database?",
        {
          supersedes: "framework",
        },
      ),
    ]),
  ],
  expect: {
    description:
      "three misheard questions each open one task; each correction supersedes its segment and raises the task to revision 2",
    opensTasks: 3,
    revisions: [2, 2, 2],
    deferredTopics: 0,
    inertEventIds: [],
  },
};

// ---- disfluency-heavy candidate answer -------------------------------------
const dis = createScript("dis");
const disfluencyHeavy: ReplayFixtureSet = {
  phases: [
    dis.phase("a hard production issue, answered with heavy disfluency", [
      interviewer(
        "Tell me about a time you had to debug a hard production issue?",
      ),
      candidate("Um, uh,"),
      candidate(
        "So, uh, I think, like, we had this, um, this queue that kept, er, backing up and, uh, nobody, you know, nobody knew why.",
      ),
      candidate("Hmm,"),
      candidate(
        "And, um, so what I, uh, what I ended up doing was, like, I added, er, I added a counter for, um, for the age of the oldest message, and, uh, you know, that showed the worker was, uh, silently retrying one poison message over and over, so, um, we moved that message aside and the queue just, uh, drained.",
      ),
      interviewer("Right."),
    ]),
  ],
  expect: {
    description:
      "heavy disfluency opens nothing: one question opens one task; fillers and the long answer are inert",
    opensTasks: 1,
    revisions: [1],
    deferredTopics: 0,
    inertEventIds: ["dis002", "dis003", "dis004", "dis005"],
  },
};

export const HAZARD_FIXTURES: Readonly<Record<string, ReplayFixtureSet>> = {
  "hazard-7a-unsupported-framework": unsupportedFramework,
  "hazard-7b-unsupported-metric": unsupportedMetric,
  "hazard-7c-leaving-roles": leavingRoles,
  "hazard-7d-notice-and-compensation": logistics,
  "backchannel-and-monologue-only": backchannelAndMonologueOnly,
  "compound-question-with-part-two": compoundWithPartTwo,
  "deferred-topic": deferredTopic,
  "asr-error-and-correction": asrErrorAndCorrection,
  "disfluency-heavy-answer": disfluencyHeavy,
};
