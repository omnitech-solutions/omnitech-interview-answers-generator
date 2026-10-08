import { randomUUID } from "node:crypto";
import {
  type CoachNote,
  type CoachNoteInput,
  type CoachNotesResponse,
  coachNoteInputSchema,
} from "@omnitech/interview-contracts";

// The most notes kept: a coach's notes are for the next minute, not a record.
const MAX_NOTES = 30;

// [DOMAIN] Held in this process only. Nothing is written to the database or
// the log, so the notes never outlive a restart and are no part of what a
// session's retention or purge has to account for.
function createCoachNotes() {
  let revision = 0;
  let notes: CoachNote[] = [];
  const snapshot = (): CoachNotesResponse => ({ revision, notes });
  return {
    get: snapshot,
    add(input: CoachNoteInput): CoachNotesResponse {
      const note: CoachNote = {
        ...coachNoteInputSchema.parse(input),
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      // Newest first; the oldest fall off the end.
      notes = [note, ...notes].slice(0, MAX_NOTES);
      revision += 1;
      return snapshot();
    },
    clear(): CoachNotesResponse {
      if (notes.length > 0) revision += 1;
      notes = [];
      return snapshot();
    },
  };
}

export const coachNotes = createCoachNotes();
