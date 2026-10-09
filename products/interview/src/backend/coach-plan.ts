import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The most a plan may hold: a page, read by the coach on every note.
export const COACH_PLAN_LENGTH = 8_000;

// [DOMAIN] The plan for a call: what the person decided beforehand (who is
// judging what, the stories to land, the questions to ask). It is theirs, so
// like the coach's notes it is kept in one file in the data directory (never
// the database, never the log) until they change or clear it. The live coach
// is given it with every stretch of the conversation.
export function createCoachPlan(filePath: string) {
  let held: string | null = null;
  const read = (): string => {
    if (held !== null) return held;
    try {
      held = readFileSync(filePath, "utf8").slice(0, COACH_PLAN_LENGTH);
    } catch {
      held = "";
    }
    return held;
  };
  return {
    get: () => ({ text: read() }),
    set(text: string) {
      held = text.slice(0, COACH_PLAN_LENGTH);
      try {
        // Written beside the file and moved over it, so a reader never sees half.
        mkdirSync(dirname(filePath), { recursive: true });
        const draft = `${filePath}.${randomUUID()}.tmp`;
        writeFileSync(draft, held);
        renameSync(draft, filePath);
      } catch {
        // Held for this process; the next change tries the file again.
      }
      return { text: held };
    },
  };
}

export const coachPlan = createCoachPlan(
  join(
    process.env["INTERVIEW_DATA_DIR"] ?? resolve(process.cwd(), ".data"),
    "coach-plan.md",
  ),
);
