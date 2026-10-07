// The Interview side of the session: a DETERMINISTIC policy for task identity.
// It implements the neutral core's TaskPolicy port and carries the assist
// stage. It decides only WHETHER an utterance opens, revises or defers a task;
// what the question is (its category) is classified by the assist stage's one
// structured call and read from its validated field, never guessed here
// (rule:structured-field-decisions). Rules, in order:
//   1. filler, backchannel and the candidate's own speech never open or
//      revise a task;
//   2. "circle back", "put a pin" defer a topic;
//   3. with an open task, "part two" / "now handle" / "what about" revise it;
//   4. a question opens ONE task (a compound question is one utterance);
//   5. a long task-less utterance is a monologue and is ignored.
// Candidate-side speech (the microphone source) never opens, revises or defers.
// These are approximations: source labels are not verified identities, so this
// only reduces noise and the policy otherwise reads text. It returns only opaque handles
// (rule:id-only-traces); no utterance text rides in a decision. Every synthetic
// replay set (session-replay-fixtures.test.ts) is run through it.

import { createHash } from "node:crypto";
import { type AssistStage, createAssistStage } from "./assist-stage";
import { type CodingStage, createCodingStage } from "./coding-stage";
import {
  isOpaqueHandle,
  type PolicyInput,
  type PolicyVerdict,
  type RevisionReason,
  type TaskPolicy,
} from "./core/index";

export interface InterviewSessionPolicy extends TaskPolicy {
  // Used to coalesce a split question across an interjected backchannel.
  isBackchannel(text: string): boolean;
  // A reaction that carries no content of its own ("okay, sure", "yes ma'am",
  // "that's great"): the one thing the other side may say between two pieces of one
  // question. A short ANSWER ("two weeks") is not one.
  isReaction(text: string): boolean;
  readonly assist: AssistStage;
  // The solution stage a coding task owes after its prose draft.
  readonly coding: CodingStage;
}

// An utterance of at least this many words with no explicit question mark is
// a monologue (context-setting), not a question.
export const MONOLOGUE_WORDS = 40;

// Compared after collapsing letter runs (see squash), so "Mm-hmm", "mmhmm",
// "Yeahhh" and "Okaaay" all match their plain entry.
const BACKCHANNELS = new Set([
  "mm hm",
  "mm hmm",
  "mmhm",
  "mmhmm",
  "mhm",
  "mm",
  "uh huh",
  "uh-huh",
  "yup",
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

// Elongation ("Yeahhh", "Mmm") collapses to one letter per run.
const squash = (text: string): string => text.replace(/(.)\1+/gu, "$1");

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
  // "follow up" as a verb or in "a follow up email/call/note" is not a follow-up question.
  [
    /(?<!\bto )\bfollow[- ]?up\b(?! (?:email|call|note|message|meeting|chat|conversation))/,
    "follow_up",
  ],
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
const SQUASHED_BACKCHANNELS = new Set(
  [...BACKCHANNELS].map((entry) => squash(normalize(entry))),
);
const words = (text: string): string[] => {
  const normalized = normalize(text);
  return normalized === "" ? [] : normalized.split(" ");
};

// An opaque handle from an event id; characters outside the handle alphabet
// are replaced so a hostile id cannot become a policy decision.
// A short id keeps its readable form; a longer one is cut and given a hash of
// the whole id, so two long ids that share a prefix never share a handle.
const HANDLE_MAX = 128;
const handleOf = (prefix: string, id: string): string => {
  const cleaned = `${prefix}-${id.replace(/[^A-Za-z0-9._:-]/g, "_")}`;
  const handle =
    cleaned.length <= HANDLE_MAX
      ? cleaned
      : `${cleaned.slice(0, HANDLE_MAX - 17)}-${createHash("sha256").update(id).digest("hex").slice(0, 16)}`;
  return isOpaqueHandle(handle) ? handle : `${prefix}-x`;
};

export function isFiller(text: string): boolean {
  const tokens = words(text);
  return tokens.length > 0 && tokens.every((token) => FILLERS.has(token));
}

// The words a reaction is made of. Closed on purpose: a short answer shares none of
// them ("two weeks", "about 165K"), so it is never mistaken for a reaction.
const REACTION_WORDS = new Set(
  [
    "mm hm hmm mhm uh huh um er erm ah eh oh wow",
    "yeah yep yes yup no nope right okay ok sure alright all",
    "got it gotcha i see great cool nice awesome perfect lovely wonderful fantastic",
    "good sounds exactly absolutely definitely totally of course interesting",
    "thanks thank you ma am sir hang on one moment second well and so that s is really",
  ]
    .join(" ")
    .split(" "),
);
export function isReaction(text: string): boolean {
  const tokens = words(text);
  return (
    tokens.length > 0 &&
    tokens.length <= 6 &&
    !text.includes("?") &&
    tokens.every((token) => REACTION_WORDS.has(squash(token)))
  );
}

export function isBackchannel(text: string): boolean {
  const tokens = words(text);
  if (tokens.length === 0 || tokens.length > 4) return false;
  return SQUASHED_BACKCHANNELS.has(squash(tokens.join(" ")));
}

// [DOMAIN] Interviewers ask in statements as often as in questions: "I'd love to
// hear what interested you", "my next question for you is...". They also wrap them
// in a long preamble, so these cues count in a long utterance too. Matched on the
// normalized text (lowercase, no punctuation: "i d love to hear").
const ASK_INTENT = [
  /\bi(?: d| would)? (?:really )?(?:love|like) to (?:hear|see|know|ask|understand|learn)\b/,
  /\bi(?: d| would)? (?:really )?(?:love|like) (?:your|for you to)\b/,
  /\bi(?: m| am) (?:curious|interested to (?:hear|know|learn))\b/,
  /\bmy (?:next|last|final|first|second|third) question\b/,
  /\bi wanted to ask (?:you|about)\b/,
  /\bcould you (?:please )?(?:walk|talk|tell|describe|explain|share)\b/,
  // The plain imperative ask, wherever it falls: a transcript has no sentence
  // boundaries, so "...interview number two tell me about a project that
  // you've worked on" must be read as an ask in the middle of the utterance.
  /\btell (?:me|us) (?:about|how|why|what|where|when)\b/,
  /\b(?:walk|talk) (?:me|us) through\b/,
  /\bdescribe (?:a|an|the|your|how|what)\b/,
  /\bexplain (?:how|why|what|the|your|a|an)\b/,
  /\bgive (?:me|us) (?:an example|a time|a situation|an instance)\b/,
  /\bshare (?:an example|a time|a situation|with (?:me|us))\b/,
];

// An ask cue only opens a task when the question text follows it. An announcement
// that trails off ("...and my next question for you now.", "I'd love to ask how you")
// is held: the question arrives in the next utterance, which opens the task, so
// the draft is never written for an empty question.
const MIN_WORDS_AFTER_ASK_CUE = 4;
function hasAskWithContent(normalized: string): boolean {
  return ASK_INTENT.some((cue) => {
    for (const match of normalized.matchAll(new RegExp(cue.source, "g"))) {
      const after = normalized
        .slice((match.index ?? 0) + match[0].length)
        .trim();
      if (after !== "" && after.split(" ").length >= MIN_WORDS_AFTER_ASK_CUE)
        return true;
    }
    return false;
  });
}

// [GUARD] Social and logistical checks carry question marks but are not interview
// questions: greetings, "can you hear me", and the "any questions about what I've
// just covered?" check-in after the role overview. A sentence like these is set
// aside before the rest is judged ("Did you have any other questions for me?" is
// still a question: it is the candidate's turn to ask).
const SOCIAL_CHECKS = [
  /\bhow(?: s| is) it going\b/,
  /\bhow are you\b/,
  /\bhow(?: have| s) your (?:day|week|morning|weekend)\b/,
  /\b(?:can|could) you (?:hear|see) me\b/,
  /\bhear me (?:ok|okay|alright|all right|clearly)\b/,
  /\bsounds? (?:ok|okay|good|alright|all right) on your end\b/,
  /\bhow about me\b/,
  /\bis this a good time\b/,
  /\b(?:can|could) you see (?:my|the) screen\b/,
  /\bany questions (?:at all )?(?:about|on|regarding) (?:what|the (?:role|overview|team)|everything)\b/,
  /\bbefore i continue\b/,
];

// A bare "?" on a very short remark ("huh?", "right?") is a reaction, not a
// question; a short question that opens with a question word ("why?") still is.
// Length counts in characters too, so text written without spaces is not mistaken
// for one short word.
const MIN_WORDS_FOR_BARE_QUESTION_MARK = 4;
const MIN_CHARS_FOR_BARE_QUESTION_MARK = 24;

function isQuestion(text: string, monologue: boolean): boolean {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter(
      (sentence) =>
        !SOCIAL_CHECKS.some((check) => check.test(normalize(sentence))),
    );
  if (sentences.length === 0) return false;
  const startsAsQuestion = (sentence: string) => {
    let lead = sentence.trim().toLowerCase();
    for (let i = 0; i < 3 && DISCOURSE_LEAD.test(lead); i += 1)
      lead = lead.replace(DISCOURSE_LEAD, "");
    return QUESTION_STARTERS.test(lead);
  };
  if (hasAskWithContent(normalize(sentences.join(" ")))) return true;
  if (
    sentences.some(
      (sentence) =>
        sentence.includes("?") &&
        (words(sentence).length >= MIN_WORDS_FOR_BARE_QUESTION_MARK ||
          sentence.trim().length >= MIN_CHARS_FOR_BARE_QUESTION_MARK ||
          startsAsQuestion(sentence)),
    )
  )
    return true;
  // A long task-less utterance needs an explicit question mark or an ask cue;
  // sentence starters alone would turn every answer's "How we did it..." into a task.
  if (monologue) return false;
  return sentences.some(startsAsQuestion);
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

  // [GUARD] Only the call's other side opens, revises or defers a task: the
  // candidate's own statements and thinking-aloud questions never do. The
  // source is a label, not a verified identity, so this only reduces noise;
  // an utterance with no source (an older sender) is still evaluated.
  if (utterance.source === "microphone")
    return {
      segmentClass: monologue ? "monologue" : "substantive",
      decision: { kind: "ignore" },
    };

  // A deferred topic stays in task state; it is not a question. But a deferral and a
  // real question often come in one breath ("we'll put a pin on this... did you have any
  // other questions for me?"): the sentences that are not the deferral are judged too,
  // and a question among them still opens a task.
  if (DEFER_CUES.some((cue) => cue.test(normalized))) {
    const rest = text
      .split(/(?<=[.!?])\s+/)
      .filter(
        (sentence) => !DEFER_CUES.some((cue) => cue.test(normalize(sentence))),
      )
      .join(" ");
    if (rest.trim() === "" || !isQuestion(rest, monologue))
      return {
        segmentClass: "substantive",
        decision: { kind: "defer", topic: handleOf("topic", utterance.id) },
      };
  }

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
    isReaction: (text) =>
      isReaction(text) || isBackchannel(text) || isFiller(text),
    decide: async (input) => decideBaseline(input),
  };
}
