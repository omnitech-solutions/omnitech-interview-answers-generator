// A scripted call: who says what, how long after the last person stopped, and
// how fast. A script is the source of a fixture; the transcript the coach is
// replayed on is made from it, piece by piece, the way a recogniser hears a
// call (a phrase arrives when it ends).
//
// [DOMAIN] The script, not the transcript, is what a simulated recording
// would be made from later: each line is one person's utterance with its
// start and its end, which is what a voice needs.

export type ScriptedLine = {
  who: string;
  // What is said. "[2.5s]" inside it is a silence of that length.
  say: string;
  // Milliseconds after the last person stopped. Below zero the line begins
  // while they are still speaking (an interruption, two people at once).
  after?: number;
  // Words a second, when not the script's.
  pace?: number;
};

export type CallScript = {
  about: string;
  // The clock time the first scripted line may begin at ("10:41:36").
  startsAt: string;
  // A recorded stretch the call opens with, and the names its labels take.
  opening?: { file: string; relabel?: Readonly<Record<string, string>> };
  pace: number;
  people: Readonly<Record<string, { part: "interviewer" | "me"; who: string }>>;
  lines: readonly ScriptedLine[];
};

export type Utterance = {
  who: string;
  text: string;
  startMs: number;
  endMs: number;
};

const clockMs = (clock: string) => {
  const [h, m, s] = clock.split(":").map(Number);
  return ((h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)) * 1000;
};
const two = (n: number) => String(n).padStart(2, "0");
const clockOf = (ms: number) =>
  `${two(Math.floor(ms / 3_600_000))}:${two(Math.floor(ms / 60_000) % 60)}:${two(Math.floor(ms / 1000) % 60)}.${String(ms % 1000).padStart(3, "0")}`;

const PAUSE = /\[(\d+(?:\.\d+)?)s\]/;
// A phrase ends at a comma, a full stop, a question or exclamation mark, an
// ellipsis or a dash: there a recogniser lets go of what it has.
const PHRASE = /[^,.?!…—]+[,.?!…—]*\s*/g;

// The pieces of the scripted lines, each with when it began and ended.
export function utterancesOf(script: CallScript): Utterance[] {
  const said: Utterance[] = [];
  let lastEndMs = clockMs(script.startsAt);
  for (const line of script.lines) {
    let at = lastEndMs + (line.after ?? 600);
    const pace = line.pace ?? script.pace;
    for (const part of line.say.split(/(\[\d+(?:\.\d+)?s\])/)) {
      const pause = PAUSE.exec(part);
      if (pause) {
        at += Math.round(Number(pause[1]) * 1000);
        continue;
      }
      for (const phrase of part.match(PHRASE) ?? []) {
        const text = phrase.trim();
        if (!text) continue;
        const words = text.split(/\s+/).length;
        const endMs = at + Math.max(300, Math.round((words / pace) * 1000));
        said.push({ who: line.who, text, startMs: at, endMs });
        at = endMs + 80;
      }
    }
    lastEndMs = Math.max(lastEndMs, at - 80);
  }
  // A piece is heard when it ends: the file is in that order.
  return said.sort((a, b) => a.endMs - b.endMs || a.startMs - b.startMs);
}

// The transcript file of a script: the recorded opening, its labels renamed,
// then the scripted pieces.
export function transcriptOf(script: CallScript, opening = ""): string {
  const renamed = Object.entries(script.opening?.relabel ?? {}).reduce(
    (text, [from, to]) => text.replace(new RegExp(`^${from}:`, "gm"), `${to}:`),
    opening.trim(),
  );
  const scripted = utterancesOf(script)
    .map(
      (each) =>
        `${clockOf(each.startMs)} --> ${clockOf(each.endMs)}\n${each.who}: ${each.text}`,
    )
    .join("\n\n");
  return `${[renamed, scripted].filter(Boolean).join("\n\n")}\n`;
}
