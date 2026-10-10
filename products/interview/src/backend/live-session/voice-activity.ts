// Voice activity from a session's audio sources (ADR-0039): whether a voice is
// being heard on the microphone or on the call RIGHT NOW. A final transcript
// line arrives only when its phrase is over, so the coach cannot tell from text
// that the interviewer is still talking; this tells it. [SAFETY] It is a
// transient signal and never content: nothing here is stored, logged or kept
// beyond a per-session count of recent reports.

import { VOICE_ACTIVITY_TUNING } from "@omnitech/active-session-contracts";
import {
  type BehaviourFlagEnvironment,
  behaviourFlagValue,
  type CoachSpeaker,
  type StoredBehaviourFlags,
} from "@omnitech/interview-contracts";
import { speakerOfSource } from "../coach-transcript";
import type { VoiceActivityHeard } from "./contracts/events";

export type { VoiceActivityHeard };

// `on` lets a session's audio sources say who is speaking. Anything else (and
// unset) keeps it off: the companion is told so on its first report, sends no
// more for that run, and the coach waits out pauses as before. It is one of
// the behaviour flags (BEHAVIOUR_FLAGS in the contracts): the environment
// variable wins when the host set it, otherwise what Settings stored, and it
// is off by default.
export const VOICE_ACTIVITY_ENV = "ACTIVE_SESSION_VOICE_ACTIVITY";

export const voiceActivityEnabled = (
  env: BehaviourFlagEnvironment = process.env,
  stored: StoredBehaviourFlags = {},
): boolean =>
  behaviourFlagValue(env, "ACTIVE_SESSION_VOICE_ACTIVITY", stored) === "on";

// [DOMAIN] Who a source's voice is, to the coach, and the telling of it: the
// call's audio is the interviewer and the microphone the person being coached
// (`speakerOfSource`, as for what is heard). The one listener the Studio
// gives ingest, so a test drives exactly what production runs.
export const tellCoachWhoSpeaks =
  (transcript: {
    setSpeaking(
      speaker: CoachSpeaker,
      speaking: boolean,
      fromLive: boolean,
      agoMs: number,
    ): void;
  }) =>
  (activity: VoiceActivityHeard): void =>
    transcript.setSpeaking(
      speakerOfSource(activity.source),
      activity.speaking,
      true,
      // A stop is told only after the detector's hangover of quiet.
      activity.speaking ? 0 : VOICE_ACTIVITY_TUNING.hangoverMs,
    );

// The most sessions counted at once; the oldest is forgotten first.
const MAX_SESSIONS = 256;

// [GUARD] Bounds how often one session's reports are taken (rule:bounded-
// ingest): at most `perMinute` in any minute that starts with a report. Held
// in memory because the signal is; a restart starts every count again.
export function createVoiceActivityGate() {
  const windows = new Map<string, { since: number; count: number }>();
  return {
    // True when this report is within the session's bound.
    allow(sessionId: string, nowMs: number, perMinute: number): boolean {
      const held = windows.get(sessionId);
      if (!held || nowMs - held.since >= 60_000 || nowMs < held.since) {
        windows.delete(sessionId);
        windows.set(sessionId, { since: nowMs, count: 1 });
        if (windows.size > MAX_SESSIONS)
          windows.delete(windows.keys().next().value as string);
        return perMinute >= 1;
      }
      if (held.count >= perMinute) return false;
      held.count += 1;
      return true;
    },
  };
}

export type VoiceActivityGate = ReturnType<typeof createVoiceActivityGate>;

// The process's own gate: every ingest route of this Studio shares it.
export const voiceActivityGate = createVoiceActivityGate();
