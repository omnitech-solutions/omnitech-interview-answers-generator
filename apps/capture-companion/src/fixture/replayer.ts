// The fixture companion's replayer. It plays a synthetic, anonymised
// recording (the shape the Interview product's replay sets already have)
// through a Companion as if it were a live call. It is defined over plain data
// so this app never imports a product: tests in the product pass the sets in.
import type { CaptureSource } from "@omnitech/active-session-contracts";
import type { Clock } from "../clock.js";
import type { Companion, TranscriptInput } from "../companion.js";
import { CompanionError } from "../errors.js";

export type ReplaySegment = {
  eventId: string;
  // "interviewer" arrives on application audio, "candidate" on the
  // microphone. Source labels, not verified identities.
  role: "interviewer" | "candidate";
  startMs: number;
  endMs: number;
  text: string;
  supersedes?: string;
};

export type ReplaySet = {
  phases: readonly { name: string; segments: readonly ReplaySegment[] }[];
};

export type ReplayOptions = {
  // 1 replays at the recording's own pacing; 4 plays it four times faster.
  speed?: number;
  clock: Clock;
};

export type ReplayResult = {
  // Event ids in emission order.
  eventIds: string[];
  elapsedMs: number;
};

export const sourceForRole = (
  role: ReplaySegment["role"],
): "microphone" | "application-audio" =>
  role === "interviewer" ? "application-audio" : "microphone";

export const replayInputOf = (segment: ReplaySegment): TranscriptInput => ({
  eventId: segment.eventId,
  source: sourceForRole(segment.role),
  text: segment.text,
  startMs: segment.startMs,
  endMs: segment.endMs,
  ...(segment.supersedes === undefined
    ? {}
    : { supersedes: segment.supersedes }),
});

// Plays every segment through `emit`, each at the moment its utterance ends
// (a final transcript exists only once the speech does), scaled by speed.
export async function replaySet(
  set: ReplaySet,
  options: ReplayOptions,
  emit: (input: TranscriptInput) => Promise<void> | void,
): Promise<ReplayResult> {
  const speed = options.speed ?? 1;
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new CompanionError("invalid_speed");
  }
  const startedAt = options.clock.now();
  const eventIds: string[] = [];
  for (const phase of set.phases) {
    for (const segment of phase.segments) {
      const due = segment.endMs / speed;
      const wait = due - (options.clock.now() - startedAt);
      // [INVARIANT] Emission order is the recording's order, even when a
      // segment's own time is earlier than its predecessor's.
      if (wait > 0) await options.clock.sleep(wait);
      await emit(replayInputOf(segment));
      eventIds.push(segment.eventId);
    }
  }
  return { eventIds, elapsedMs: options.clock.now() - startedAt };
}

// The usual case: replay a recording into a running companion.
export const replayInto = (
  companion: Companion,
  set: ReplaySet,
  options: ReplayOptions,
): Promise<ReplayResult> =>
  replaySet(set, options, (input) => companion.observeTranscript(input));

export type { CaptureSource };
