// When the coach acts.
//
// PROBLEM: speech arrives as fragments of one to ten words, a question can
// take fifteen seconds to ask, and the person being coached can read a note
// only at certain moments. Acting on a pause alone acts on half a question;
// acting on every pause calls a model every few seconds.
// STRATEGY: the unit is a TURN (everything one side says before the other
// side speaks), not a pause. The coach acts once per turn of the interviewer,
// at the earliest moment the turn can be told to be over, and looks at the
// candidate's own answer only now and then. This file is that decision as a
// pure function of what has been heard and the clock: no model, no I/O, so it
// can be replayed over a recorded call and its every choice explained.
// COMPLEXITY: O(new lines) per decision.
import type { CoachTranscriptLine } from "@omnitech/interview-contracts";

export type TurnTiming = {
  // Silence after a turn that reads as a finished question.
  finishedMs: number;
  // Silence after a turn that reads as finished talk, but not a question.
  pauseMs: number;
  // Silence after a turn that trails off ("so, um…", "and our,"): the asker
  // is thinking, so the coach waits, but never for ever.
  trailingMs: number;
  // While the candidate answers: the least they must have said, and the
  // least time since the coach last acted, before it looks at the answer.
  candidateWords: number;
  candidateEveryMs: number;
  // A sentence gap in the candidate's answer: the moment to look.
  candidateGapMs: number;
};

export const TURN_TIMING: TurnTiming = {
  finishedMs: 800,
  pauseMs: 2_500,
  trailingMs: 6_000,
  candidateWords: 60,
  candidateEveryMs: 20_000,
  candidateGapMs: 1_200,
};

// Why the coach acts on a stretch, in a word a replay can print.
export type ActReason =
  // The interviewer's question reads as finished and they have paused.
  | "question-finished"
  // The interviewer stopped talking (not a question, or one that trailed off).
  | "pause"
  // The other side started speaking: the turn is certainly over.
  | "speaker-change"
  // The candidate has been answering for a while: a look, to steer if needed.
  | "answer-check"
  // What is on the shared screen changed (live coding): a look at the task.
  | "screen-change";

// [DOMAIN] Text arrives when its speaker has finished a phrase, so the last
// line heard says nothing about whether they are still talking: the next
// phrase may be half said. Where a source can say who is speaking, that is
// the stronger evidence, and the coach never acts on a turn whose speaker is
// still going.
export type Speaking = { interviewer: boolean; candidate: boolean };

export type Decision =
  | { action: "wait"; why: string }
  | {
      action: "act";
      reason: ActReason;
      // The stretch to read: every new line through this one.
      until: number;
      // Whose turn the stretch ends on.
      about: "interviewer" | "candidate";
    };

// The words of a line, without the punctuation that ends them: "Okay." is the
// word "okay", and "node.js" keeps its point.
const wordsOf = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z0-9][a-z0-9'+#.-]*/g) ?? []).map((word) =>
    word.replace(/[.'-]+$/, ""),
  );

// [DOMAIN] Sounds that are not speech with content: a line made only of
// these neither starts a turn nor ends one. Recorders and speech recognisers
// produce them constantly, often under the wrong speaker.
const FILLER = new Set(
  "um uh er ah oh hmm mm mhm yeah yes yep no nope ok okay alright right so and well like cool nice awesome perfect great sure exactly gotcha thanks thank you know i guess mean sorry".split(
    " ",
  ),
);
export const isNoise = (text: string): boolean => {
  const said = wordsOf(text);
  return said.length <= 4 && said.every((word) => FILLER.has(word));
};
const substance = (text: string): number =>
  wordsOf(text).filter((word) => !FILLER.has(word)).length;

// The least a line must say to be a turn of its own. A shorter line from the
// other side ("Yes.", "For sure.") is a backchannel inside the current turn.
const TURN_WORDS = 3;
// The least an interviewer's turn must say to be worth a look.
const QUESTION_WORDS = 4;

// [DOMAIN] A turn reads as a finished question when it ends on a question
// mark, or asks for something ("tell me about", "walk me through") and ends
// on a full stop. Speech recognition punctuates unevenly, so both count.
const REQUESTS =
  /\b(?:tell|walk|talk|show|give|take) (?:me|us)\b|\b(?:i(?:'d| would)? (?:like|love|want) to (?:hear|know|understand))\b|\b(?:can|could|would) you\b|\bdo you have\b/;
const ENDS_SENTENCE = /[.?!]["')\]]*$/;
const ENDS_QUESTION = /\?["')\]]*$/;
// It trails off when its last words promise more: a comma, an ellipsis, a
// filler, or a word that cannot end a sentence.
// Only words that cannot end a sentence: "that", "to", "about" and "is" can
// ("thanks for that.", "what it is about."), so they are not here.
const DANGLING = new Set(
  "and or but so the a an our your their my to of for with which because if when while um uh".split(
    " ",
  ),
);
export function readsAs(text: string): "question" | "finished" | "trailing" {
  const trimmed = text.trim();
  const last = wordsOf(trimmed).at(-1) ?? "";
  if (ENDS_QUESTION.test(trimmed)) return "question";
  // A recogniser puts a full stop after a sentence the speaker abandoned
  // ("…is about the."), so the last word decides before the punctuation does.
  if (/[,…]$|\.\.\.$/.test(trimmed) || DANGLING.has(last)) return "trailing";
  if (ENDS_SENTENCE.test(trimmed)) {
    // What is asked for is in the last sentence, not somewhere before it.
    const closing = trimmed.split(/(?<=[.?!])\s+/).at(-1) ?? trimmed;
    return REQUESTS.test(closing.toLowerCase()) ? "question" : "finished";
  }
  return "trailing";
}

// [GUARD] The call heard again through the microphone is not the candidate
// speaking: a candidate line made mostly of the interviewer's last words is
// left out (the live window does the same for what it shows).
const ECHO_SHARE = 0.7;
function echoes(line: string, of: string): boolean {
  const said = wordsOf(line);
  if (said.length < 4) return false;
  const theirs = new Set(wordsOf(of));
  return (
    said.filter((word) => theirs.has(word)).length / said.length >= ECHO_SHARE
  );
}

export type Turn = {
  side: "interviewer" | "candidate";
  text: string;
  // Words that carry content.
  words: number;
  // The last line of the turn.
  until: number;
};

// The new lines as turns. A speaker the recorder could not name ("unknown")
// continues whoever was speaking when it says little, and is the interviewer
// when it says a sentence: the coach would sooner read a line too many from
// the other side than miss a question.
export function turnsOf(lines: readonly CoachTranscriptLine[]): Turn[] {
  const turns: Turn[] = [];
  for (const line of lines) {
    const current = turns.at(-1);
    const noise = isNoise(line.text);
    const said = substance(line.text);
    const side: Turn["side"] =
      line.speaker === "candidate"
        ? "candidate"
        : line.speaker === "interviewer"
          ? "interviewer"
          : said < TURN_WORDS && current
            ? current.side
            : "interviewer";
    if (
      side === "candidate" &&
      current?.side === "interviewer" &&
      echoes(line.text, current.text)
    ) {
      current.until = line.seq;
      continue;
    }
    // Noise, and a few words from the other side, stay inside the turn.
    if (current && (current.side === side || noise || said < TURN_WORDS)) {
      if (current.side === side && !noise)
        current.text = `${current.text} ${line.text}`.trim();
      if (current.side === side) current.words += said;
      current.until = line.seq;
      continue;
    }
    if (noise) continue;
    turns.push({ side, text: line.text, words: said, until: line.seq });
  }
  return turns;
}

// What to do now, given the lines not yet decided on.
export function decide(input: {
  // The lines the model has not decided on, oldest first.
  fresh: readonly CoachTranscriptLine[];
  // How long since any line arrived, and since the coach last acted.
  silenceMs: number;
  sinceActMs: number;
  timing?: Partial<TurnTiming>;
  // Who is speaking right now, where that is known (a voice-activity signal,
  // or a recording's timings). Absent: not known.
  speaking?: Speaking;
}): Decision {
  const timing = { ...TURN_TIMING, ...input.timing };
  const turns = turnsOf(input.fresh);
  if (turns.length === 0) return { action: "wait", why: "nothing said" };

  // [STRATEGY] The first turn of the interviewer's that says something is
  // the one to answer; a backlog is so walked one question at a time.
  const at = turns.findIndex(
    (turn) => turn.side === "interviewer" && turn.words >= QUESTION_WORDS,
  );
  const theirs = at >= 0 ? (turns[at] as Turn) : undefined;
  if (theirs) {
    const answered = turns
      .slice(at + 1)
      .some((turn) => turn.side === "candidate");
    // The candidate has started to answer: the question is over, whatever
    // its punctuation says. This is the certain signal, and the late one.
    // The interviewer is still talking: whatever the text so far reads as,
    // the turn is not over.
    if (input.speaking?.interviewer)
      return { action: "wait", why: "the interviewer is still speaking" };
    if (answered)
      return {
        action: "act",
        reason: "speaker-change",
        until: theirs.until,
        about: "interviewer",
      };
    const reads = readsAs(theirs.text);
    // A turn that trails off is waited on for long only when the coach
    // cannot tell whether its speaker has stopped. Where it can, and they
    // have, the ordinary pause is enough.
    const need =
      reads === "question"
        ? timing.finishedMs
        : reads === "finished" || input.speaking
          ? timing.pauseMs
          : timing.trailingMs;
    if (input.silenceMs >= need)
      return {
        action: "act",
        reason: reads === "question" ? "question-finished" : "pause",
        until: theirs.until,
        about: "interviewer",
      };
    return {
      action: "wait",
      why:
        reads === "trailing"
          ? "the interviewer has not finished the sentence"
          : "the interviewer may go on",
    };
  }

  // Only the candidate has spoken: they are answering.
  const mine = turns.at(-1) as Turn;
  const said = turns.reduce(
    (sum, turn) => sum + (turn.side === "candidate" ? turn.words : 0),
    0,
  );
  if (said < timing.candidateWords)
    return { action: "wait", why: "the candidate has said little yet" };
  if (input.sinceActMs < timing.candidateEveryMs)
    return { action: "wait", why: "the coach looked at this answer recently" };
  // The gap is read from the text alone: an answer is one long stretch of
  // speech, and a look is wanted at a sentence's end inside it, which a
  // phrase arriving marks and "still speaking" would hide.
  if (input.silenceMs < timing.candidateGapMs)
    return { action: "wait", why: "the candidate is mid-sentence" };
  return {
    action: "act",
    reason: "answer-check",
    until: mine.until,
    about: "candidate",
  };
}

// [DOMAIN] A call is already answering the interviewer's turn and they have
// said more: the question was not finished after all. The call is made again
// with the whole turn, unless the candidate has begun to answer (too late to
// change the question) or what was added says nothing.
export function shouldRecall(
  added: readonly CoachTranscriptLine[],
  // What the interviewer said in the turn being answered: the microphone
  // hearing it again is not the candidate beginning to answer.
  answering = "",
): boolean {
  const turns = turnsOf(
    added.filter(
      (line) => !(line.speaker === "candidate" && echoes(line.text, answering)),
    ),
  );
  const first = turns[0];
  return (
    first !== undefined &&
    first.side === "interviewer" &&
    first.words >= TURN_WORDS &&
    !turns.some((turn) => turn.side === "candidate")
  );
}
