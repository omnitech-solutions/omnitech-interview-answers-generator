// Who is on the panel, as the plan for the call says it.
//
// PROBLEM: in a panel the coach should aim an answer at what the person who
// asked is judging, and may say who asked. Both need the panel's names, and
// the only place the person has written them is the plan, which is free text.
// STRATEGY: one forgiving line of the plan is read as the roster:
//
//   panel: Priya (hiring manager), Marcus (staff engineer: reliability), Tom
//
// The line starts with `panel:`, `panelists:`, `interviewers:` or
// `who is there:` (any case; a leading "-", "*" or "#" is ignored). People are
// separated by commas or semicolons; what a person judges follows the name in
// brackets, or after " - " or ": ". A plan with no such line has no roster,
// and everything works as it did for one interviewer.
// [GUARD] The roster is read, never guessed: an entry that does not start
// with a capitalised name of at most three words is left out.
import { coachVoiceNameSchema } from "@omnitech/interview-contracts";

export type Panelist = {
  name: string;
  // What they do or judge, in the plan's own words. Absent when not said.
  judges?: string;
};

const ROSTER_LINE =
  /^\s*(?:[-*#]+\s*)?\**(?:panel(?:ists?)?|interviewers|who is there)\**\s*:\s*(.+)$/i;
const PANEL_MOST = 8;
const JUDGES_LENGTH = 120;

// The entries of a roster line: split at commas and semicolons that are not
// inside brackets ("Marcus (reliability, payments), Tom" is two people).
function entriesOf(text: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if ((char === "," || char === ";") && depth === 0) {
      entries.push(text.slice(from, at));
      from = at + 1;
    }
  }
  entries.push(text.slice(from));
  return entries.map((entry) => entry.trim()).filter(Boolean);
}

const ENTRY =
  /^(?:and\s+)?([^(:–—]+?)\s*(?:\((.*)\)|(?:\s[-–—]\s|:\s*)(.+))?\.?$/;

function panelistOf(entry: string): Panelist | undefined {
  const found = ENTRY.exec(entry);
  const name = found?.[1]?.trim() ?? "";
  if (
    !/^\p{Lu}/u.test(name) ||
    name.split(/\s+/).length > 3 ||
    !coachVoiceNameSchema.safeParse(name).success
  )
    return undefined;
  const judges = (found?.[2] ?? found?.[3] ?? "").trim();
  return {
    name,
    ...(judges ? { judges: judges.slice(0, JUDGES_LENGTH) } : {}),
  };
}

export function rosterOf(plan: string | undefined): Panelist[] {
  const roster: Panelist[] = [];
  for (const line of (plan ?? "").split(/\r?\n/)) {
    const found = ROSTER_LINE.exec(line);
    if (!found) continue;
    for (const entry of entriesOf(found[1] as string)) {
      const panelist = panelistOf(entry);
      if (
        panelist &&
        !roster.some(
          (held) => held.name.toLowerCase() === panelist.name.toLowerCase(),
        )
      )
        roster.push(panelist);
    }
  }
  return roster.slice(0, PANEL_MOST);
}

// [SAFETY] The name a note may carry for who asked: the one of `known` that
// `said` is (the same name, or a first name alone when only one of them has it),
// in that list's own spelling. Anything else is no name: the model's word
// that "Tom" asked is never taken when nobody known is called Tom.
export function voiceAmong(
  said: string | undefined,
  known: readonly string[],
): string | undefined {
  const wanted = (said ?? "")
    .replace(/\(.*$/, "")
    .replace(/[.,;:!?]+$/, "")
    .trim()
    .toLowerCase();
  if (!wanted) return undefined;
  const whole = known.find((name) => name.toLowerCase() === wanted);
  if (whole) return whole;
  // A first name alone stands for the one person who has it; anything longer
  // must be a whole name ("Marcus and Elena" is nobody).
  if (/\s/.test(wanted)) return undefined;
  const sameFirst = known.filter(
    (name) => name.toLowerCase().split(/\s+/)[0] === wanted,
  );
  return sameFirst.length === 1 ? sameFirst[0] : undefined;
}
