// The Interview side of the session: a DETERMINISTIC policy for task identity.
// It implements the neutral core's TaskPolicy port and carries the assist
// stage. It decides only WHETHER an utterance opens, revises or defers a task;
// what the question is (its category) is classified by the assist stage's one
// structured call and read from its validated field, never guessed here
// (rule:structured-field-decisions). Rules, in order:
//   1. filler and backchannel never open or revise a task;
//   2. "circle back", "put a pin" defer a topic;
//   3. with an open task, "part two" / "now handle" / "what about" revise it;
//   4. a question opens ONE task (a compound question is one utterance);
//   5. a long task-less utterance is a monologue and is ignored.
// These are approximations: source labels are not verified identities, so the
// policy reads text, never who said it. It returns only opaque handles
// (rule:id-only-traces); no utterance text rides in a decision. Every synthetic
// replay set (session-replay-fixtures.test.ts) is run through it.

import { type AssistStage, createAssistStage } from "./assist-stage.js";
import { type CodingStage, createCodingStage } from "./coding-stage.js";
import {
  isOpaqueHandle,
  type PolicyInput,
  type PolicyVerdict,
  type RevisionReason,
  type TaskPolicy,
} from "./core/index.js";

export interface InterviewSessionPolicy extends TaskPolicy {
  // Used to coalesce a split question across an interjected backchannel.
  isBackchannel(text: string): boolean;
  readonly assist: AssistStage;
  // The solution stage a coding task owes after its prose draft.
  readonly coding: CodingStage;
}

// An utterance of at least this many words with no explicit question mark is
// a monologue (context-setting), not a question.
export const MONOLOGUE_WORDS = 40;

const BACKCHANNELS = new Set([
  "mm hm",
  "mmhm",
  "mhm",
  "mm",
  "uh huh",
  "yeah",
  "yep",
  "yes",
  "right",
  "okay",
  "ok",
  "sure",
  "got it",
  "i see",
  "great",
  "cool",
  "nice",
  "exactly",
  "absolutely",
  "gotcha",
  "sounds good",
  "interesting",
  "no",
  "nope",
  "thanks",
  "thank you",
]);
const FILLERS = new Set(["um", "uh", "er", "erm", "hmm", "ah", "eh"]);

const QUESTION_STARTERS =
  /^(what|why|how|when|where|who|which|can you|could you|would you|will you|do you|did you|have you|are you|were you|is there|tell me|walk me through|talk me through|describe|explain|give me)\b/;
const DISCOURSE_LEAD = /^(so|okay|ok|and|now|alright|um|uh|well|then)\b[\s,]*/;

const DEFER_CUES = [
  /\bcircle back\b/,
  /\bput a pin\b/,
  /\bcome back to (that|this|it)\b/,
  /\bpark (that|this|it)\b/,
];
const REVISE_CUES: ReadonlyArray<readonly [RegExp, RevisionReason]> = [
  [/\bpart (two|2)\b/, "follow_up"],
  [/\bfollow[- ]?up\b/, "follow_up"],
  [/\bnow handle\b/, "constraint_changed"],
  [/\balso handle\b/, "constraint_changed"],
  [/\bwhat about\b/, "constraint_changed"],
  [/\bwhat if\b/, "constraint_changed"],
  [/\bnow make it\b/, "constraint_changed"],
  [/\binstead\b/, "constraint_changed"],
];

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const words = (text: string): string[] => {
  const normalized = normalize(text);
  return normalized === "" ? [] : normalized.split(" ");
};

// An opaque handle from an event id; characters outside the handle alphabet
// are replaced so a hostile id cannot become a policy decision.
const handleOf = (prefix: string, id: string): string => {
  const handle = `${prefix}-${id.replace(/[^A-Za-z0-9._:-]/g, "_")}`.slice(
    0,
    128,
  );
  return isOpaqueHandle(handle) ? handle : `${prefix}-x`;
};

export function isFiller(text: string): boolean {
  const tokens = words(text);
  return tokens.length > 0 && tokens.every((token) => FILLERS.has(token));
}

export function isBackchannel(text: string): boolean {
  const tokens = words(text);
  if (tokens.length === 0 || tokens.length > 4) return false;
  return BACKCHANNELS.has(tokens.join(" "));
}

function isQuestion(text: string, monologue: boolean): boolean {
  if (text.includes("?")) return true;
  // A long task-less utterance needs an explicit question mark; sentence
  // starters alone would turn every answer's "How we did it..." into a task.
  if (monologue) return false;
  return text.split(/(?<=[.!?])\s+/).some((sentence) => {
    let lead = sentence.trim().toLowerCase();
    for (let i = 0; i < 3 && DISCOURSE_LEAD.test(lead); i += 1)
      lead = lead.replace(DISCOURSE_LEAD, "");
    return QUESTION_STARTERS.test(lead);
  });
}

export function decideBaseline(input: PolicyInput): PolicyVerdict {
  const { utterance, openTasks } = input;
  const text = utterance.text;
  const normalized = normalize(text);
  const wordCount = words(text).length;
  const monologue = wordCount >= MONOLOGUE_WORDS;

  // [GUARD] Filler and backchannel never open or revise a task.
  if (isFiller(text))
    return { segmentClass: "filler", decision: { kind: "ignore" } };
  if (isBackchannel(text))
    return { segmentClass: "backchannel", decision: { kind: "ignore" } };

  // A deferred topic stays in task state; it is not a question.
  if (DEFER_CUES.some((cue) => cue.test(normalized)))
    return {
      segmentClass: "substantive",
      decision: { kind: "defer", topic: handleOf("topic", utterance.id) },
    };

  // [STRATEGY] A follow-up or changed constraint revises the latest task; a
  // long utterance is a monologue and never revises.
  const latest = openTasks[openTasks.length - 1];
  if (latest && !monologue) {
    for (const [cue, reason] of REVISE_CUES)
      if (cue.test(normalized))
        return {
          segmentClass: "substantive",
          decision: { kind: "revise", taskId: latest.taskId, reason },
        };
  }

  // A question opens one logical task, however many parts it has. The task is
  // named after the segment that carries the question (the first of its
  // correction chain), so it keeps its name whether a context sentence before
  // it was folded into the utterance or not, and whether the run saw the
  // question before or after its ASR correction.
  if (isQuestion(text, monologue)) {
    const carrier =
      utterance.parts?.find((part) =>
        isQuestion(part.text, words(part.text).length >= MONOLOGUE_WORDS),
      )?.originId ?? utterance.id;
    return {
      segmentClass: "substantive",
      decision: { kind: "open", taskKey: handleOf("q", carrier) },
    };
  }

  return {
    segmentClass: monologue ? "monologue" : "substantive",
    decision: { kind: "ignore" },
  };
}

export function createInterviewSessionPolicy(
  options: { assist?: AssistStage; coding?: CodingStage } = {},
): InterviewSessionPolicy {
  return {
    assist: options.assist ?? createAssistStage(),
    coding: options.coding ?? createCodingStage(),
    isBackchannel: (text) => isBackchannel(text) || isFiller(text),
    decide: async (input) => decideBaseline(input),
  };
}
