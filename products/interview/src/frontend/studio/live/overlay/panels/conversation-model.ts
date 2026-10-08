// The conversation, as the person follows it while speaking: one turn per
// question the interviewer asked, with what belongs to it underneath (the
// coach's notes, the studio's answer, what the person said). It is a reading
// of the same rows the transcript shows; nothing here fetches or decides.
import type { CoachNote } from "@omnitech/interview-contracts";
import type { PanelRow } from "./panel-model";

// [DOMAIN] An interviewer line opens a turn only when it asks something of the
// person: it is long enough to be more than an acknowledgement and it carries
// a question word or a request ("tell me", "walk me through"). A thank-you or
// a closing remark is an aside of the turn it follows, never a question.
export const QUESTION_WORDS = 5;
const ASKS =
  /\b(?:how|what|why|where|when|which|who|whose)\b|\b(?:do|did|does|are|is|was|were|have|has|can|could|would|will|should) (?:you|we|it|they|there|that)\b|\b(?:tell|walk|talk|show|give) (?:me|us)\b|\b(?:describe|explain|i want to hear|i would like to hear|curious to hear|any questions)\b/;
// The microphone also hears the call through the speakers. A line of the
// person's that repeats an interviewer line this close in time is that echo.
const ECHO_WINDOW_MS = 30_000;
const ECHO_SHARE = 0.7;
// A heard question with no restatement from the coach is cut to this length
// in the questions list.
const ASK_LENGTH = 60;

export type Turn = {
  key: string;
  at: number;
  // What was asked. Null only for what came before the first question.
  question: PanelRow | null;
  // The coach's restatement of the question, when a note carries one.
  ask: string | null;
  // Interviewer lines after the question that ask nothing.
  asides: PanelRow[];
  // The coach's notes for this question, oldest first.
  notes: CoachNote[];
  // The studio's own answers to it.
  studio: PanelRow[];
  // What the person said or typed.
  mine: PanelRow[];
};

const words = (text: string): string[] =>
  text.toLowerCase().match(/[a-z0-9']+/g) ?? [];

export const asksSomething = (text: string): boolean =>
  words(text).length >= QUESTION_WORDS && ASKS.test(text.toLowerCase());

// One line repeats another when most of the shorter one's words are in the
// longer one.
export function echoes(a: string, b: string): boolean {
  const [short, long] = [words(a), words(b)].sort(
    (left, right) => left.length - right.length,
  ) as [string[], string[]];
  if (short.length < QUESTION_WORDS) return false;
  const held = new Set(long);
  const shared = short.filter((word) => held.has(word)).length;
  return shared / short.length >= ECHO_SHARE;
}

const isInterviewer = (row: PanelRow) =>
  row.kind === "heard" && row.speaker === "interviewer";

export function conversationTurns(
  rows: readonly PanelRow[],
  notes: readonly CoachNote[],
): Turn[] {
  // [GUARD] The call heard again through the microphone is not the person's
  // answer: it is left out, so a turn shows each thing once.
  const theirs = rows.filter(isInterviewer);
  const kept = rows.filter(
    (row) =>
      !(
        row.kind === "heard" &&
        row.speaker === "you" &&
        theirs.some(
          (other) =>
            Math.abs(other.at - row.at) <= ECHO_WINDOW_MS &&
            echoes(row.text, other.text),
        )
      ),
  );

  // [STRATEGY] One pass over the rows in time order: a question opens a turn
  // and every row after it joins that turn until the next question.
  const turns: Turn[] = [];
  const open = (question: PanelRow | null, at: number): Turn => {
    const turn: Turn = {
      key: question?.key ?? "before",
      at,
      question,
      ask: null,
      asides: [],
      notes: [],
      studio: [],
      mine: [],
    };
    turns.push(turn);
    return turn;
  };
  for (const row of kept) {
    if (isInterviewer(row) && asksSomething(row.text)) {
      open(row, row.at);
      continue;
    }
    const turn = turns[turns.length - 1] ?? open(null, row.at);
    if (isInterviewer(row)) turn.asides.push(row);
    else if (row.kind === "assistant" || row.kind === "problem")
      turn.studio.push(row);
    else turn.mine.push(row);
  }

  // [STRATEGY] A note joins the question its coach named (the turn that
  // already holds a note with the same ask id). Otherwise it joins the last
  // question asked before it was posted, unless the coach has already filed
  // that one under another ask: then the note is for a question the
  // transcript did not open (a rephrasing, a follow-up, nothing heard at all)
  // and it opens a turn of its own, so no question's notes pile onto another.
  const ordered = [...notes].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  for (const note of ordered) {
    const at = Date.parse(note.createdAt);
    const named = note.askId
      ? turns.find((each) =>
          each.notes.some((held) => held.askId === note.askId),
        )
      : undefined;
    // Only a question asked before the note can be the one it is for.
    const nearest = turns.findLast((each) => each.at <= at);
    const taken =
      note.askId !== undefined &&
      (nearest?.notes.some(
        (held) => held.askId !== undefined && held.askId !== note.askId,
      ) ??
        false);
    let turn = named ?? (taken ? undefined : nearest);
    if (!turn) {
      turn = open(null, at);
      turn.key = note.askId ? `ask-${note.askId}` : `note-${note.id}`;
      turns.sort((a, b) => a.at - b.at);
    }
    turn.notes.push(note);
    if (note.ask) turn.ask = note.ask;
  }
  return turns;
}

// The question on the table: the newest turn that has one.
export const currentQuestion = (turns: readonly Turn[]): PanelRow | null =>
  turns.findLast((turn) => turn.question !== null)?.question ?? null;

// The questions, for the list and the notes. `live` is the one on the table.
//
// [DOMAIN] An interviewer rephrases, prompts and follows up, and each of those
// is heard as its own question. Once a coach is writing notes, a question in
// the list is one the coach has answered (it holds notes): a row with nothing
// under it is only a distraction. Everything else that was asked belongs to
// the answered question before it, as a follow-up, with whatever was said and
// answered under it. The one exception is the question just asked, whose
// notes have not arrived: it is `waitingTurn`, named above the notes on show
// and given no row until it has notes of its own. With no coach's notes at
// all, every question heard is listed.
export type Question = Turn & {
  number: number;
  live: boolean;
  label: string;
  // What else was asked under this question, oldest first.
  followUps: PanelRow[];
};

// The question just asked that the coach has not answered yet, if there is one.
export function waitingTurn(turns: readonly Turn[]): Turn | undefined {
  const lastNoted = turns.findLastIndex((turn) => turn.notes.length > 0);
  const last = turns[turns.length - 1];
  return lastNoted >= 0 &&
    last !== undefined &&
    turns.length - 1 > lastNoted &&
    last.question !== null
    ? last
    : undefined;
}

export function questionsOf(turns: readonly Turn[]): Question[] {
  const coached = turns.some((turn) => turn.notes.length > 0);
  const waiting = waitingTurn(turns);
  const asked: (Turn & { followUps: PanelRow[] })[] = [];
  for (const turn of turns) {
    if (turn === waiting) continue;
    if (turn.notes.length > 0 || (!coached && turn.question !== null)) {
      asked.push({ ...turn, followUps: [] });
      continue;
    }
    // Asked before the coach's first note, with nothing to hang it on.
    const previous = asked[asked.length - 1];
    if (!previous) continue;
    if (turn.question) previous.followUps.push(turn.question);
    previous.asides = [...previous.asides, ...turn.asides];
    previous.studio = [...previous.studio, ...turn.studio];
    previous.mine = [...previous.mine, ...turn.mine];
  }
  return asked.map((turn, at) => {
    const heard = turn.question?.text ?? turn.notes[0]?.title ?? "";
    return {
      ...turn,
      number: at + 1,
      live: at === asked.length - 1,
      // The coach's words when there are any; otherwise what was heard, cut.
      label:
        turn.ask ??
        (heard.length > ASK_LENGTH
          ? `${heard.slice(0, ASK_LENGTH).trimEnd()}…`
          : heard),
    };
  });
}

// [DOMAIN] What the interviewer said in passing is heard as one long run of
// speech: all grey it cannot be scanned, and all white it competes with the
// notes. So the words that carry it (the subject, the thing asked about) are
// lifted a little and the rest of the sentence stays quiet: the eye lands on
// "behavioural", "challenges", "people" and can skip the "you know there
// would be" around them. It is a reading aid over the heard text, nothing is
// rewritten.
const QUIET_WORDS = new Set(
  `about above after again also another around because been before being
  both could does doing down each even ever every from going have having
  here into just kind know like made make many maybe more most much must
  only other over really said same should since some something sort such
  than that their them then there these they thing things think this those
  through under until usually very want well were what when where which
  while will with would yeah your yours okay right sounds good great sure
  actually basically little guess mean means well`.split(/\s+/),
);
const CARRIES = 5;
export type HeardPiece = { text: string; strong: boolean };
export function heardEmphasis(text: string): HeardPiece[] {
  const pieces: HeardPiece[] = [];
  for (const token of text.split(/(\s+)/)) {
    if (token === "") continue;
    const word = token.toLowerCase().replace(/[^a-z']/g, "");
    const strong = word.length >= CARRIES && !QUIET_WORDS.has(word);
    const last = pieces[pieces.length - 1];
    // Neighbours of the same weight (and the spaces between) are one piece.
    if (last && (last.strong === strong || /^\s+$/.test(token)))
      last.text += token;
    else pieces.push({ text: token, strong });
  }
  return pieces;
}
