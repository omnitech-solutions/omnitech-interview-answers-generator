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

const storedSchema = z.object({ notes: z.array(z.unknown()) });

// [DOMAIN] Notes written before the note's shape changed are still the
// person's notes: each is read into today's shape where it can be (an earlier
// section of labelled points becomes a "say" section, bold its evidence; an
// earlier kind takes its nearest present one) and a note that still does not
// fit is left out by itself, never the whole file with it.
const EARLIER_KIND: Record<string, CoachNote["kind"]> = {
  answer: "direct-answer",
  close: "closing",
  steer: "follow-up",
  "ask-them": "direct-answer",
};
const lineOf = (text: string) => ({
  segments: text
    .split("**")
    .map((piece, at) => ({
      text: piece,
      role: at % 2 === 1 ? ("evidence" as const) : ("spoken" as const),
    }))
    .filter((segment) => segment.text !== ""),
});
function readNote(raw: unknown): CoachNote[] {
  if (typeof raw !== "object" || raw === null) return [];
  const { wants: _wants, steer, ...note } = raw as Record<string, unknown>;
  const kind = typeof note["kind"] === "string" ? note["kind"] : undefined;
  const sections = Array.isArray(note["sections"]) ? note["sections"] : [];
  const earlierSteer = steer as { issue?: string; say?: string } | undefined;
  const read = coachNoteSchema.safeParse({
    ...note,
    ...(kind && EARLIER_KIND[kind] ? { kind: EARLIER_KIND[kind] } : {}),
    sections: [
      ...sections.map((section: { points?: string[]; label?: string }) =>
        Array.isArray(section.points)
          ? {
              kind: "say",
              ...(section.label ? { label: section.label } : {}),
              lines: section.points.map(lineOf),
            }
          : section,
      ),
      ...(earlierSteer?.issue
        ? [
            {
              kind: "caution",
              lines: [earlierSteer.issue, earlierSteer.say]
                .filter((text): text is string => Boolean(text))
                .map(lineOf),
            },
          ]
        : []),
    ].slice(0, 4),
  });
  return read.success ? [read.data] : [];
}

// [DOMAIN] The notes are the person's own record of what they were coached to
// say, so they outlive a restart: they are kept in one file in the data
// directory (never the database, never the log) until the person clears them.
// A file that cannot be read or written never stops a note reaching the
// window: the notes are then held for this process only.
export function createCoachNotes(filePath: string) {
  // [GUARD] Starts from the clock, not from zero: a window that polled this
  // process before a restart must see a different number after it, or it
  // would keep showing what the last process held.
  let revision = Date.now();
  let notes: CoachNote[] | null = null;
  // Read once, on first use, so loading this module touches no file.
  const held = (): CoachNote[] => {
    if (notes) return notes;
    try {
      notes = storedSchema
        .parse(JSON.parse(readFileSync(filePath, "utf8")))
        .notes.flatMap(readNote);
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
    // Null when the note is an older revision of one already held: refused.
    add(input: CoachNoteInput): CoachNotesResponse | null {
      const { at, ...parsed } = coachNoteInputSchema.parse(input);
      const earlier = parsed.key
        ? held().find((each) => each.key === parsed.key)
        : undefined;
      if (earlier) {
        // [GUARD] A slow, older answer never overwrites a newer one. An equal
        // revision only completes a note that is still pending.
        const stale =
          parsed.revision < earlier.revision ||
          (parsed.revision === earlier.revision && earlier.status === "ready");
        if (stale) return null;
        const next: CoachNote =
          parsed.status === "pending"
            ? // Being prepared: what is on show stays until it is ready.
              { ...earlier, status: "pending", revision: parsed.revision }
            : // Ready: it takes the earlier note's place, where it stands.
              { ...parsed, id: earlier.id, createdAt: earlier.createdAt };
        keep(held().map((each) => (each === earlier ? next : each)));
        return snapshot();
      }
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
