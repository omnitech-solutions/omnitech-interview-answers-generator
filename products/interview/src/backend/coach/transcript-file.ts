// A recorded conversation as a file, read for replaying through the coach.
//
// Three shapes are read, told apart by what the lines look like:
//   - a recorder's blocks:  "00:01:12 --> 00:01:19" then "Speaker 1: text"
//     (also WebVTT and SRT, whose time lines carry fractions and cue numbers)
//   - plain labelled lines: "Gosha: text"
//   - plain text:           one unlabelled speaker
// [DOMAIN] Nothing is joined here: a replay wants each fragment at the moment
// it was said, because when the coach acts depends on exactly that.
import type { CoachSpeaker } from "@omnitech/interview-contracts";

export type SpokenBlock = {
  // The label the recorder gave ("Speaker 1", "Unknown"); "" when none.
  label: string;
  text: string;
  // Milliseconds from the start of the recording's clock.
  startMs: number;
  endMs: number;
};

// A clock time with or without its hours: WebVTT may write "01:12.500".
const CLOCK = String.raw`(?:(\d{1,2}):)?(\d{2}):(\d{2})(?:[.,](\d{1,3}))?`;
const TIMING = new RegExp(`^${CLOCK}\\s*-->\\s*${CLOCK}`);
// A speaker's label is a name and a colon, then a space: an address or a
// clock time at the start of a line is not one.
const SPOKEN = /^([A-Za-z][^:/]{0,39}):(?:\s+|$)(.*)$/;
const ms = (h?: string, m?: string, s?: string, f?: string) =>
  (Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s)) * 1000 +
  Number((f ?? "0").padEnd(3, "0"));
// Without time lines, speech is paced at an ordinary speaking rate.
const MS_PER_WORD = 400;

export function readTranscript(source: string): SpokenBlock[] {
  const blocks: SpokenBlock[] = [];
  let startMs = 0;
  let endMs = 0;
  let timed = false;
  // Only the first line after a time line (or the very first) names a speaker
  // in a timed file; in an untimed one every line may.
  let opens = true;
  let label = "";
  for (const raw of source.split(/\r?\n/)) {
    // A WebVTT voice tag names the speaker ("<v Dana>…"): it becomes a label
    // like any other; the rest of a cue's markup says nothing.
    const line = raw
      .replace(/^\s*<v(?:\.[\w.-]+)?\s+([^>]+)>/, "$1: ")
      .replace(/<[^>]+>/g, "")
      .trim();
    // A cue number, a "WEBVTT" header and a blank line say nothing.
    if (!line || /^\d+$/.test(line) || /^WEBVTT\b/.test(line)) continue;
    const timing = TIMING.exec(line);
    if (timing) {
      timed = true;
      opens = true;
      startMs = ms(timing[1], timing[2], timing[3], timing[4]);
      endMs = ms(timing[5], timing[6], timing[7], timing[8]);
      continue;
    }
    const spoken = opens || !timed ? SPOKEN.exec(line) : null;
    opens = false;
    if (spoken) label = (spoken[1] as string).trim();
    const text = (spoken ? (spoken[2] ?? "") : line).trim();
    if (!text) continue;
    if (!timed) {
      startMs = endMs;
      endMs = startMs + Math.max(1, text.split(/\s+/).length) * MS_PER_WORD;
    }
    blocks.push({ label, text, startMs, endMs: Math.max(endMs, startMs) });
  }
  return blocks;
}

export type SpeakerSummary = {
  label: string;
  blocks: number;
  words: number;
  // The first thing of some length they said, to tell who they are.
  sample: string;
};

// Who is in the file, the most talkative first.
export function speakersOf(blocks: readonly SpokenBlock[]): SpeakerSummary[] {
  const found = new Map<string, SpeakerSummary>();
  for (const block of blocks) {
    const words = block.text.split(/\s+/).filter(Boolean).length;
    const held = found.get(block.label) ?? {
      label: block.label,
      blocks: 0,
      words: 0,
      sample: "",
    };
    held.blocks += 1;
    held.words += words;
    if (held.sample === "" && words >= 6) held.sample = block.text;
    found.set(block.label, held);
  }
  return [...found.values()].sort((a, b) => b.words - a.words);
}

// What a replay does with each label.
//   interviewer  the other side of the call
//   me           the person being coached
//   unknown      kept, as a speaker the coach cannot name
//   leave-out    not given to the coach at all
export type SpeakerRole = CoachSpeaker | "me" | "leave-out";
export type Cast = Readonly<Record<string, SpeakerRole>>;

// The blocks the coach is to hear, each as a speaker it knows. A label the
// cast does not name is unknown. `hideMe` leaves the coached person's own
// lines out as well, to see what the coach does from the questions alone.
export function castBlocks(
  blocks: readonly SpokenBlock[],
  cast: Cast,
  options: { hideMe?: boolean; fromMs?: number; toMs?: number } = {},
): (SpokenBlock & { speaker: CoachSpeaker })[] {
  return blocks.flatMap((block) => {
    if (options.fromMs !== undefined && block.endMs < options.fromMs) return [];
    if (options.toMs !== undefined && block.startMs > options.toMs) return [];
    const role = Object.hasOwn(cast, block.label)
      ? (cast[block.label] as SpeakerRole)
      : "unknown";
    if (role === "leave-out" || (role === "me" && options.hideMe)) return [];
    return [{ ...block, speaker: role === "me" ? "candidate" : role }];
  });
}
