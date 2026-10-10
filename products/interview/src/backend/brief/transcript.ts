// A stage's transcript as speaker turns.
//
// [DOMAIN] `readTranscript` (the coach's replay reader) gives each fragment at
// the moment it was said, because a replay needs that. A reader of a stored
// transcript wants what one person said before the other spoke: consecutive
// fragments of one speaker are one TURN, from the first fragment's start to
// the last one's end. The formats are exactly the ones `readTranscript`
// parses: a recorder's timed blocks (also WebVTT and SRT), plain labelled
// lines, and plain text.
import { createHash } from "node:crypto";
import type { TranscriptTurn } from "@omnitech/interview-contracts";
import { readTranscript } from "../coach/transcript-file";

export const sha256Of = (text: string) =>
  createHash("sha256").update(text).digest("hex");

export function turnsOf(text: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const block of readTranscript(text)) {
    const last = turns.at(-1);
    if (last && last.speaker === block.label) {
      last.text = `${last.text} ${block.text}`;
      last.endMs = Math.max(last.endMs, block.endMs);
    } else
      turns.push({
        speaker: block.label,
        text: block.text,
        startMs: block.startMs,
        endMs: block.endMs,
      });
  }
  return turns;
}

// A time on the transcript's own clock, as it is written in the file.
export function clockOf(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const part = (value: number) => String(value).padStart(2, "0");
  return `${part(Math.floor(seconds / 3600))}:${part(Math.floor(seconds / 60) % 60)}:${part(seconds % 60)}`;
}

// [GUARD] What cannot be a transcript: bytes that are not text (a binary
// file, or one that is not UTF-8), and text in which nothing was said.
export function decodeTranscript(bytes: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  // A NUL is never in a transcript: the file is not text.
  return text.includes("\u0000") ? null : text;
}
