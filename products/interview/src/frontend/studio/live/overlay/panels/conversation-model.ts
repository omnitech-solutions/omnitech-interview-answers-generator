// The conversation, as the person follows it while speaking: one turn per
// question the interviewer asked, with what belongs to it underneath (the
// coach's notes, the studio's answer, what the person said). It is a reading
// of the same rows the transcript shows; nothing here fetches or decides.
import type { CoachNote } from "@omnitech/interview-contracts";
import type { PanelRow } from "./panel-model";

// [DOMAIN] An interviewer line this long opens a turn. Shorter ones ("OK",
// "Sounds good") are asides of the turn they follow, never a question.
export const QUESTION_WORDS = 5;
// The microphone also hears the call through the speakers. A line of the
// person's that repeats an interviewer line this close in time is that echo.
const ECHO_WINDOW_MS = 30_000;
const ECHO_SHARE = 0.7;

export type Turn = {
  key: string;
  at: number;
  // What was asked. Null only for what came before the first question.
  question: PanelRow | null;
  // Short interviewer lines after the question.
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
      asides: [],
      notes: [],
      studio: [],
      mine: [],
    };
    turns.push(turn);
    return turn;
  };
  for (const row of kept) {
    const asks = isInterviewer(row) && words(row.text).length >= QUESTION_WORDS;
    if (asks) {
      open(row, row.at);
      continue;
    }
    const turn = turns[turns.length - 1] ?? open(null, row.at);
    if (isInterviewer(row)) turn.asides.push(row);
    else if (row.kind === "assistant" || row.kind === "problem")
      turn.studio.push(row);
    else turn.mine.push(row);
  }

  // [STRATEGY] A note is for the last question asked before it was posted.
  // A note with no turn yet (nothing heard) waits in a turn of its own.
  const ordered = [...notes].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  for (const note of ordered) {
    const at = Date.parse(note.createdAt);
    const turn =
      turns.findLast((each) => each.at <= at) ?? turns[0] ?? open(null, at);
    turn.notes.push(note);
  }
  return turns;
}

// The question on the table: the newest turn that has one.
export const currentQuestion = (turns: readonly Turn[]): PanelRow | null =>
  turns.findLast((turn) => turn.question !== null)?.question ?? null;
