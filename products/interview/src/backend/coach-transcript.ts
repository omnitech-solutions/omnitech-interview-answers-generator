import { randomUUID } from "node:crypto";
import {
  type CoachSpace,
  type CoachSpeaker,
  type CoachTranscriptLine,
  type CoachTranscriptLineInput,
  type CoachTranscriptResponse,
  type CoachTranscriptSession,
  coachVoiceNameSchema,
} from "@omnitech/interview-contracts";

// The most lines held: several hours of talk. The oldest fall off.
const MAX_LINES = 4_000;
// The most of a screen's text held: a full editor pane.
const SCREEN_CHARS = 8_000;
// How long a "speaking" stands without being said again.
const SPEAKING_LAPSES_MS = 5_000;

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
  let ledger: unknown;
  // What is on the shared screen now, as text. The latest only.
  let screen: { text: string; at: string } | undefined;
  // Whose conversation is held: a live session's, or one attached to replay.
  let space: CoachSpace = "live";
  // Who is speaking now, by when each last said so. [GUARD] A "speaking" that
  // is never followed by its "stopped" (a source that dropped) lapses, so a
  // lost signal can never hold the coach back for good.
  const speakingSince = new Map<CoachSpeaker, number>();
  let activityKnown = false;
  // When each speaker's voice last stopped, as its source said.
  const stoppedAt = new Map<CoachSpeaker, number>();
  const speakingNow = (): CoachSpeaker[] => {
    const now = Date.now();
    for (const [speaker, at] of speakingSince)
      if (now - at > SPEAKING_LAPSES_MS) speakingSince.delete(speaker);
    return [...speakingSince.keys()];
  };
  const held = () => ({
    space,
    ...(activityKnown
      ? {
          speaking: speakingNow(),
          stopped: [...stoppedAt]
            .filter(([speaker]) => !speakingSince.has(speaker))
            .map(([speaker, at]) => ({
              speaker,
              at: new Date(at).toISOString(),
            })),
        }
      : {}),
    // A replay is coached from itself alone, never from a session's record.
    ...(session && space === "live" ? { session } : {}),
    ...(screen ? { screen } : {}),
  });
  return {
    add(
      added: readonly CoachTranscriptLineInput[],
      // The live session the lines were heard in; absent for a replay.
      from?: CoachTranscriptSession,
    ): CoachTranscriptResponse {
      // [GUARD] A live line after a replay (or the reverse) is another
      // conversation: the two are never read as one.
      const into: CoachSpace = from ? "live" : "replay";
      if (into !== space) {
        this.clear();
        space = into;
      }
      if (from) session = from;
      for (const line of added) {
        const text = line.text.trim();
        if (!text) continue;
        seq += 1;
        lines.push({
          seq,
          speaker: line.speaker ?? "unknown",
          // Carried as the source gave it; never made up here.
          ...(line.name ? { name: line.name } : {}),
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
    // An audio source says its speaker started or stopped. A source that
    // keeps saying "speaking" keeps it alive; silence from it lets it lapse.
    setSpeaking(
      speaker: CoachSpeaker,
      speaking: boolean,
      // From a live session's own audio: it says nothing about a replay.
      fromLive = false,
      // How long ago the change happened (a detector's hangover).
      agoMs = 0,
    ): void {
      if (fromLive && space !== "live") return;
      activityKnown = true;
      if (speaking) {
        speakingSince.set(speaker, Date.now());
        stoppedAt.delete(speaker);
      } else {
        // [GUARD] Only a voice that was known to be speaking has a stop worth
        // dating: a repeated "not speaking" must not move it.
        if (speakingSince.has(speaker) || !stoppedAt.has(speaker))
          stoppedAt.set(speaker, Date.now() - agoMs);
        speakingSince.delete(speaker);
      }
    },
    // The text of the latest capture of the screen takes the last one's place.
    setScreen(text: string, from?: CoachTranscriptSession): void {
      const read = text.trim().slice(0, SCREEN_CHARS);
      // A live session's screen says nothing about a replay in progress.
      if (!read || space !== "live") return;
      if (from) session = from;
      screen = { text: read, at: new Date().toISOString() };
    },
    // [DOMAIN] The coach's own ledger of this conversation (how far it read,
    // what it has said), held with the conversation so that a coach which
    // restarts takes up where the last one stopped. It goes when the
    // conversation does, and like it is never written anywhere.
    ledger(forEpoch: string): unknown {
      return ledger && forEpoch === epoch ? ledger : undefined;
    },
    setLedger(forEpoch: string, kept: unknown): boolean {
      if (forEpoch !== epoch) return false;
      ledger = kept;
      return true;
    },
    clear(): CoachTranscriptResponse {
      ledger = undefined;
      screen = undefined;
      speakingSince.clear();
      stoppedAt.clear();
      activityKnown = false;
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
// [DOMAIN] When `speakers` names more than one label as the interviewer (a
// panel), each of their lines keeps its label as the voice's name: the
// recorder told them apart, and the coach can then say who asked. With one
// interviewer there is nothing to tell apart and no name is carried.
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
  const panel =
    Object.values(options.speakers ?? {}).filter(
      (speaker) => speaker === "interviewer",
    ).length > 1;
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
    const speaker = options.speakers?.[label] ?? "unknown";
    out.push({
      label,
      speaker,
      ...(panel &&
      speaker === "interviewer" &&
      coachVoiceNameSchema.safeParse(label).success
        ? { name: label }
        : {}),
      text,
      at: new Date(started + offsetMs).toISOString(),
    });
  }
  return out.map(({ label: _label, ...line }) => line);
}
