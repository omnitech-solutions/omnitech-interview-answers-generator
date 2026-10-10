// Whether a voice is being heard on one of the session's audio sources right
// now. [SAFETY] A transient signal, never content: nothing of the report is
// written (no observation, no artifact, not even the contact stamp, so a
// heartbeat's spacing is untouched) and nothing of it is logged. It is taken
// only while the session is capturing, only for an audio source the session
// registered at start, only when the owner's switch is on, and only for a
// session whose owner allows processing off this device (the listener is the
// coach, on a remote model). Everything else is a content-free refusal;
// voice_activity_off tells the companion to stop sending for the rest of its
// run.
import {
  VOICE_ACTIVITY_ACK_EVENT_ID,
  type VoiceActivity,
  validateWireMessage,
  voiceActivitySchema,
} from "@omnitech/active-session-contracts";
import type { IngestHandler } from "../contracts/ingest";
import { validationRefusal } from "../domain/observation";
import {
  permittedSources,
  voiceActivityAllowed,
  withoutCapture,
} from "../domain/session-policy";
import { voiceActivityGate } from "../voice-activity";
import { accepted, refusal } from "./acknowledgement";

export const handleVoiceActivity: IngestHandler = (context, envelope) => {
  const { scope, session, status, closed, cancelJobs, limits } = context;
  // A pending capture request rides only on the answers the companion reads
  // for one (a heartbeat, an observation), never on this.
  const standing = withoutCapture(context.control);
  const validated = validateWireMessage<VoiceActivity>(
    voiceActivitySchema,
    envelope,
  );
  if (!validated.ok) {
    const invalid = validationRefusal(validated.issues);
    return {
      ack: refusal(invalid.code, {
        control: standing,
        issues: validated.issues,
      }),
      cancelJobs,
    };
  }
  if (status !== "active")
    return {
      ack: refusal(closed ?? "session_paused", { control: standing }),
      cancelJobs,
    };
  // The owner's switch: a function is asked at every report.
  const switchedOn =
    typeof context.voiceActivity === "function"
      ? context.voiceActivity() === true
      : context.voiceActivity === true;
  if (!voiceActivityAllowed(session, switchedOn))
    return {
      ack: refusal("voice_activity_off", { control: standing }),
      cancelJobs,
    };
  // [SAFETY] The companion cannot broaden the sources fixed at start: a
  // source the session never registered says nothing here.
  if (!permittedSources(session).includes(validated.value.source))
    return {
      ack: refusal("invalid_observation", {
        control: standing,
        issues: [{ path: ["source"], code: "invalid_value" }],
      }),
      cancelJobs,
    };
  // [GUARD] Bounded per session and minute, in memory because the signal is.
  const gate = context.activityGate ?? voiceActivityGate;
  if (!gate.allow(session.id, session.nowMs, limits.maxVoiceActivityPerMinute))
    return {
      ack: refusal("rate_limited", { control: standing }),
      cancelJobs,
      retryAfterSeconds: 1,
    };
  return {
    ack: accepted(
      validated.value.sourceId,
      VOICE_ACTIVITY_ACK_EVENT_ID,
      standing,
    ),
    cancelJobs,
    activity: {
      source: validated.value.source,
      speaking: validated.value.speaking,
      session: { ...scope, sessionId: session.id },
    },
  };
};
