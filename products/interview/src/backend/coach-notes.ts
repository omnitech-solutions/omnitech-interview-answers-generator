import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type CoachNote,
  type CoachNoteInput,
  type CoachNotesResponse,
  coachNoteInputSchema,
  coachNoteSchema,
} from "@omnitech/interview-contracts";
import { z } from "zod";

// The most notes kept: enough for a long interview with every follow-up.
const MAX_NOTES = 200;

const storedSchema = z.object({ notes: z.array(coachNoteSchema) });

// [DOMAIN] The notes are the person's own record of what they were coached to
// say, so they outlive a restart: they are kept in one file in the data
// directory (never the database, never the log) until the person clears them.
// A file that cannot be read or written never stops a note reaching the
// window: the notes are then held for this process only.
export function createCoachNotes(filePath: string) {
  let revision = 0;
  let notes: CoachNote[] | null = null;
  // Read once, on first use, so loading this module touches no file.
  const held = (): CoachNote[] => {
    if (notes) return notes;
    try {
      notes = storedSchema.parse(
        JSON.parse(readFileSync(filePath, "utf8")),
      ).notes;
    } catch {
      notes = [];
    }
    return notes;
  };
  const keep = (next: CoachNote[]) => {
    notes = next;
    revision += 1;
    try {
      // Written beside the file and moved over it, so a reader never sees half.
      mkdirSync(dirname(filePath), { recursive: true });
      const draft = `${filePath}.${randomUUID()}.tmp`;
      writeFileSync(draft, JSON.stringify({ notes: next }));
      renameSync(draft, filePath);
    } catch {
      // Held in memory; the next change tries the file again.
    }
  };
  const snapshot = (): CoachNotesResponse => ({ revision, notes: held() });
  return {
    get: snapshot,
    add(input: CoachNoteInput): CoachNotesResponse {
      const { at, ...parsed } = coachNoteInputSchema.parse(input);
      const note: CoachNote = {
        ...parsed,
        id: randomUUID(),
        createdAt: at ?? new Date().toISOString(),
      };
      // Newest first by the moment each was for; the oldest fall off the end.
      keep(
        [note, ...held()]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, MAX_NOTES),
      );
      return snapshot();
    },
    clear(): CoachNotesResponse {
      if (held().length > 0) keep([]);
      return snapshot();
    },
  };
}

export const coachNotes = createCoachNotes(
  join(
    process.env["INTERVIEW_DATA_DIR"] ?? resolve(process.cwd(), ".data"),
    "coach-notes.json",
  ),
);
