import { randomUUID } from "node:crypto";
import type {
  CoachSpeaker,
  CoachTranscriptLine,
  CoachTranscriptLineInput,
  CoachTranscriptResponse,
  CoachTranscriptSession,
} from "@omnitech/interview-contracts";

// The most lines held: several hours of talk. The oldest fall off.
const MAX_LINES = 4_000;

// [DOMAIN] The coach's transcript, held by this process only. It is what a
// coach (an agent in the worker, holding the API token) reads to decide what
// to say next. [SAFETY] Nothing here is written anywhere: not the database,
// not a file, not the log. A restart or a clear starts a new epoch, and a
// reader that sees one starts again.
export function createCoachTranscript() {
  let epoch = randomUUID();
  let lines: CoachTranscriptLine[] = [];
  let seq = 0;
  // The live session last heard, by its ids only. It outlives a clear, so a
  // transcript attached afterwards is coached with that session's context.
  let session: CoachTranscriptSession | undefined;
  const held = () => (session ? { session } : {});
  return {
    add(
      added: readonly CoachTranscriptLineInput[],
      from?: CoachTranscriptSession,
    ): CoachTranscriptResponse {
      if (from) session = from;
      for (const line of added) {
        const text = line.text.trim();
        if (!text) continue;
        seq += 1;
        lines.push({
          seq,
          speaker: line.speaker ?? "unknown",
          text,
          at: line.at ?? new Date().toISOString(),
        });
      }
      if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
      return { epoch, cursor: seq, lines: [], ...held() };
    },
    // The lines after `after`, oldest first.
    since(after = 0): CoachTranscriptResponse {
      return {
        epoch,
        cursor: seq,
        lines: lines.filter((line) => line.seq > after),
        ...held(),
      };
    },
    clear(): CoachTranscriptResponse {
      epoch = randomUUID();
      lines = [];
      seq = 0;
      return { epoch, cursor: 0, lines: [], ...held() };
    },
  };
}

export const coachTranscript = createCoachTranscript();

// [DOMAIN] Who a live session's audio source is, to the coach: the microphone
// is the person being coached, and the call's own audio is the interviewer.
// The label is a source, never a verified identity.
export const speakerOfSource = (source: string | undefined): CoachSpeaker =>
  source === "microphone"
    ? "candidate"
    : source === "application-audio"
      ? "interviewer"
      : "unknown";

// A transcript exported by a meeting recorder, as lines:
//
//   00:01:12 --> 00:01:19
//   Speaker 1: So tell me about a time you led a migration.
//
// Blocks are separated by a blank line. The time is the offset from the start
// of the recording; `startedAt` places it on the clock. A speaker label is
// mapped by `speakers` ("Speaker 1" -> interviewer); an unmapped one is
// unknown. [STRATEGY] Recorders cut a sentence into many short blocks, so
// consecutive blocks by one speaker are joined into the one thing they said.
// [GUARD] Only the first line of a block can name its speaker: a later line
// with a colon in it ("Note: we shipped", an address) is more of what was said.
const TIMING = /^(\d{1,2}):(\d{2}):(\d{2})(?:[.,]\d+)?\s*-->/;
// A speaker's label is a name and a colon, then a space: an address or a
// clock time at the start of a line is not one.
const SPOKEN = /^([A-Za-z][^:/]{0,39}):(?:\s+|$)(.*)$/;
const JOIN_CHARS = 1_200;

export function parseTranscriptFile(
  source: string,
  options: {
    speakers?: Readonly<Record<string, CoachSpeaker>>;
    startedAt?: Date;
  } = {},
): CoachTranscriptLineInput[] {
  const started = (options.startedAt ?? new Date()).getTime();
  const out: (CoachTranscriptLineInput & { label: string })[] = [];
  let offsetMs = 0;
  // True on the line straight after a time line (or at the very start).
  let opens = true;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const timing = TIMING.exec(line);
    if (timing) {
      opens = true;
      offsetMs =
        (Number(timing[1]) * 3600 +
          Number(timing[2]) * 60 +
          Number(timing[3])) *
        1000;
      continue;
    }
    const last = out.at(-1);
    const spoken = opens ? SPOKEN.exec(line) : null;
    opens = false;
    // An unlabelled line carries on what the last speaker was saying.
    const label = spoken?.[1]?.trim() ?? last?.label ?? "";
    const text = (spoken ? spoken[2] : line)?.trim() ?? "";
    if (!text) continue;
    if (
      last &&
      last.label === label &&
      last.text.length + text.length < JOIN_CHARS
    ) {
      last.text = `${last.text} ${text}`;
      continue;
    }
    out.push({
      label,
      speaker: options.speakers?.[label] ?? "unknown",
      text,
      at: new Date(started + offsetMs).toISOString(),
    });
  }
  return out.map(({ label: _label, ...line }) => line);
}
