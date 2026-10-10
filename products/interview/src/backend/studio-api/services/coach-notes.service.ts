import type { CoachNoteInput, CoachSpace } from "@omnitech/interview-contracts";
import { coachNotes, replayCoachNotes } from "../../coach-notes";
import { coachTranscript } from "../../coach-transcript";
import { coachWriters, parseWriter } from "../../coach-writer";
import { conversationIsCurrent } from "../domain/conversation";

const notesOf = (space: CoachSpace) =>
  space === "replay" ? replayCoachNotes : coachNotes;

export function readNotes(space: CoachSpace, revision: string | undefined) {
  const held = notesOf(space).get();
  return revision === String(held.revision) ? null : held;
}

export function addNote(
  space: CoachSpace,
  input: CoachNoteInput,
  writer: string | undefined,
  conversation: string | undefined,
) {
  // Preserve the pen check before reading the conversation or changing notes.
  if (writer !== undefined) {
    const claim = parseWriter(writer);
    if (!claim || !coachWriters.accepts(claim)) {
      return { kind: "stale_writer" } as const;
    }
  }
  if (
    conversation !== undefined &&
    !conversationIsCurrent(
      conversation,
      coachTranscript.since(Number.MAX_SAFE_INTEGER).epoch,
    )
  ) {
    return { kind: "stale_conversation" } as const;
  }
  const added = notesOf(space).add(input);
  if (!added) return { kind: "stale_coach_note" } as const;
  return { kind: "added", notes: added } as const;
}

export function clearNotes(space: CoachSpace) {
  // Closing a replay clears only the conversation those notes were for.
  if (coachTranscript.since(Number.MAX_SAFE_INTEGER).space === space) {
    coachTranscript.clear();
  }
  return notesOf(space).clear();
}
