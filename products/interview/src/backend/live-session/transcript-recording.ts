// The owner's own recording of what a live session hears, as a transcript
// file on this machine.
//
// [DOMAIN] A session's observations are deleted when it ends (ADR-0011). A
// recording is a second, explicit keep: it exists only because the owner
// pressed record, holds nothing from before that moment, and is a plain file
// they can open, replay through the coach, or delete.
// [SAFETY] It is off until asked for, every time: the state lives in this
// process only, so a restart, like the end of a session, leaves it off. The
// words go to the file and nowhere else (never the database, never the log).
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { HeardLine } from "./ingest";

export type RecordingState = {
  on: boolean;
  // When this recording began; absent when off.
  startedAt?: string;
  // The file's name within the transcripts folder; absent when never started.
  file?: string;
  // How many lines it holds so far.
  lines: number;
};

// Who a line is, as a label the replay reads back: the call's own audio is
// the other side, the microphone is the owner, anything else is unnamed.
const LABEL: Record<string, string> = {
  "application-audio": "Interviewer",
  microphone: "Me",
};
const clock = (at: Date) => at.toTimeString().slice(0, 8);

export function createTranscriptRecordings(directory: string) {
  const held = new Map<
    string,
    {
      path: string;
      file: string;
      startedAt: string;
      lines: number;
      lastMs: number;
    }
  >();
  const live = new Set<string>();
  const stateOf = (sessionId: string): RecordingState => {
    const recording = held.get(sessionId);
    const on = live.has(sessionId);
    return recording
      ? {
          on,
          ...(on ? { startedAt: recording.startedAt } : {}),
          file: recording.file,
          lines: recording.lines,
        }
      : { on: false, lines: 0 };
  };
  return {
    state: stateOf,
    start(sessionId: string): RecordingState {
      if (!live.has(sessionId)) {
        const now = new Date();
        // One file per press of record: an earlier one is never added to.
        // Named to the millisecond, so stop and record again is a new file.
        const file = `${now.toISOString().slice(0, 23).replace(/[:.]/g, "-")}-${sessionId.slice(0, 8)}.txt`;
        mkdirSync(directory, { recursive: true });
        // The file exists from the press, so it can be named at once.
        appendFileSync(join(directory, file), "", { mode: 0o600 });
        held.set(sessionId, {
          path: join(directory, file),
          file,
          startedAt: now.toISOString(),
          lines: 0,
          lastMs: now.getTime(),
        });
        live.add(sessionId);
      }
      return stateOf(sessionId);
    },
    stop(sessionId: string): RecordingState {
      live.delete(sessionId);
      return stateOf(sessionId);
    },
    // One heard line, written as a block the replay reads:
    //   10:40:01 --> 10:40:09
    //   Interviewer: how do you decide …
    // A line is timed from the one before it to when it was heard, which is
    // how a recogniser delivers speech: whole, at its end.
    heard(line: HeardLine): void {
      const recording = held.get(line.session.sessionId);
      if (!recording || !live.has(line.session.sessionId)) return;
      const end = new Date(line.occurredAt);
      const endMs = Number.isNaN(end.getTime()) ? Date.now() : end.getTime();
      const start = new Date(Math.min(recording.lastMs, endMs));
      try {
        appendFileSync(
          recording.path,
          `${clock(start)} --> ${clock(new Date(endMs))}\n${LABEL[line.source ?? ""] ?? "Heard"}: ${line.text.replace(/\s+/g, " ").trim()}\n\n`,
          { mode: 0o600 },
        );
        recording.lines += 1;
        recording.lastMs = endMs;
      } catch {
        // A disk that cannot be written loses the line, never the session.
      }
    },
  };
}

export type TranscriptRecordings = ReturnType<
  typeof createTranscriptRecordings
>;

export const transcriptRecordings = createTranscriptRecordings(
  join(
    process.env["INTERVIEW_DATA_DIR"] ?? resolve(process.cwd(), ".data"),
    "transcripts",
  ),
);
