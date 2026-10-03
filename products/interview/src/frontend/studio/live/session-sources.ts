// Source health, companion contact and credential state, derived (pure) from
// the session record and the observations read so far.
import type {
  LiveCaptureSource,
  LiveObservation,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { parseDisconnectedContent, parseGapContent } from "./session-results";

export const CAPTURE_SOURCES: readonly LiveCaptureSource[] = [
  "microphone",
  "application-audio",
  "screen",
];

// The source states a screen can show.
//   receiving        selected, nothing wrong, and heard from (or the companion
//                    is in contact)
//   waiting          selected, nothing observed yet and no companion contact
//   disconnected     the person stopped it (source.disconnected user-stopped)
//   lost-permission  the OS permission was revoked (its own state)
//   lost             the device was lost or capture errored
//   gap              audio was dropped (capture.gap); capture may be back
//   not-selected     not one of this session's sources
export type SourceHealth =
  | "receiving"
  | "waiting"
  | "disconnected"
  | "lost-permission"
  | "lost"
  | "gap"
  | "not-selected";

// The labels name a capture channel, never a person: a source is not a
// verified speaker identity.
export const SOURCE_LABEL: Record<LiveCaptureSource, string> = {
  microphone: "Microphone",
  "application-audio": "App audio",
  screen: "Screen",
};
export const SOURCE_NOTE: Record<LiveCaptureSource, string> = {
  microphone: "Labelled “Microphone”, not a speaker name",
  "application-audio": "May contain several people. Gaps are recorded.",
  screen: "Snapshots of the selected window, not video",
};

export type SourceStatus = {
  source: LiveCaptureSource;
  label: string;
  note: string;
  selected: boolean;
  health: SourceHealth;
  // When the problem began (the observation's server time); null when healthy.
  since: string | null;
  // The disconnect or gap reason, as sent.
  reason: string | null;
  gapMs: number | null;
  // True for the states that mean capture is not happening.
  lost: boolean;
};

// The wire names a source by an opaque id; the companion may use the capture
// source's own name or a short alias ("mic", "scr"). A disconnect or gap names
// its capture source in the content, which teaches the mapping for that id.
const ALIAS: readonly [RegExp, LiveCaptureSource][] = [
  [/^(mic|microphone)/i, "microphone"],
  [/^(app|application)/i, "application-audio"],
  [/^(scr|screen)/i, "screen"],
];

export type SourceIndex = {
  sourceOf(observation: LiveObservation): LiveCaptureSource | null;
};

export function sourceIndex(
  observations: readonly LiveObservation[],
): SourceIndex {
  const learned = new Map<string, LiveCaptureSource>();
  for (const observation of observations) {
    const named =
      observation.kind === "source.disconnected"
        ? parseDisconnectedContent(observation.content.body)?.source
        : observation.kind === "capture.gap"
          ? parseGapContent(observation.content.body)?.source
          : undefined;
    if (named) learned.set(observation.sourceId, named);
  }
  return {
    sourceOf(observation) {
      if (observation.kind === "screen.snapshot") return "screen";
      const exact = CAPTURE_SOURCES.find((s) => s === observation.sourceId);
      if (exact) return exact;
      const taught = learned.get(observation.sourceId);
      if (taught) return taught;
      return (
        ALIAS.find(([pattern]) => pattern.test(observation.sourceId))?.[1] ??
        null
      );
    },
  };
}

type Unresolved = {
  health: SourceHealth;
  since: string;
  reason: string;
  gapMs: number | null;
};

// The newest observation per source decides: a disconnect or a dropped-audio
// gap stands until a LATER transcript or screen observation from the same
// source clears it. A gap recorded because the session was paused is expected
// and neither raises nor clears anything.
function unresolvedBySource(
  observations: readonly LiveObservation[],
  index: SourceIndex,
): Map<LiveCaptureSource, Unresolved | "clear"> {
  const state = new Map<LiveCaptureSource, Unresolved | "clear">();
  for (const observation of observations) {
    const source = index.sourceOf(observation);
    if (!source) continue;
    if (observation.kind === "source.disconnected") {
      const content = parseDisconnectedContent(observation.content.body);
      if (!content) continue;
      state.set(content.source, {
        health:
          content.reason === "user-stopped"
            ? "disconnected"
            : content.reason === "permission-revoked"
              ? "lost-permission"
              : "lost",
        since: observation.receivedAt,
        reason: content.reason,
        gapMs: null,
      });
    } else if (observation.kind === "capture.gap") {
      const content = parseGapContent(observation.content.body);
      if (!content || content.reason === "paused") continue;
      state.set(content.source, {
        health: "gap",
        since: observation.receivedAt,
        reason: content.reason,
        gapMs: content.durationMs,
      });
    } else if (
      observation.kind === "transcript.final" ||
      observation.kind === "screen.snapshot"
    ) {
      state.set(source, "clear");
    }
  }
  return state;
}

export function sourceStatuses(
  session: LiveSessionView,
  observations: readonly LiveObservation[],
  companionInContact: boolean,
): SourceStatus[] {
  const state = unresolvedBySource(observations, sourceIndex(observations));
  return CAPTURE_SOURCES.map((source) => {
    const selected = session.captureSources.includes(source);
    const found = state.get(source);
    const issue = found && found !== "clear" ? found : null;
    const health: SourceHealth = !selected
      ? "not-selected"
      : issue
        ? issue.health
        : found === "clear" || companionInContact
          ? "receiving"
          : "waiting";
    return {
      source,
      label: SOURCE_LABEL[source],
      note: SOURCE_NOTE[source],
      selected,
      health,
      since: selected && issue ? issue.since : null,
      reason: selected && issue ? issue.reason : null,
      gapMs: selected && issue ? issue.gapMs : null,
      lost:
        health === "disconnected" ||
        health === "lost-permission" ||
        health === "lost",
    };
  });
}

// ---- Companion and credential ------------------------------------------------

// The companion sends a content-free heartbeat; the server stamps
// lastHeartbeatAt on contact. The wire contract fixes no interval, so this
// mirrors the processor's own staleness rule (HEARTBEAT_STALE_MS, two minutes,
// status-transition.ts): older than that, the companion is treated as offline.
export const COMPANION_OFFLINE_AFTER_MS = 2 * 60 * 1000;
// A credential within this long of expiring is flagged so the owner can renew
// before capture pauses. The credential lives 2 hours (ADR-0012).
export const CREDENTIAL_EXPIRING_SOON_MS = 10 * 60 * 1000;

// never-seen: the server has recorded no contact, so nothing may say the
// companion is connected. online: contact within the threshold. offline:
// contact was recorded but is older.
export type CompanionStatus = "never-seen" | "online" | "offline";
export type CredentialState =
  | "none"
  | "valid"
  | "expiring-soon"
  | "expired"
  | "revoked";

export type CompanionModel = {
  status: CompanionStatus;
  lastContactAt: string | null;
  ageMs: number | null;
  credential: CredentialState;
  credentialExpiresInMs: number | null;
};

export function companionModel(
  session: LiveSessionView,
  serverNowMs: number,
): CompanionModel {
  const contact = session.lastHeartbeatAt
    ? Date.parse(session.lastHeartbeatAt)
    : Number.NaN;
  const ageMs = Number.isNaN(contact)
    ? null
    : Math.max(0, serverNowMs - contact);
  const status: CompanionStatus =
    ageMs === null
      ? "never-seen"
      : ageMs <= COMPANION_OFFLINE_AFTER_MS
        ? "online"
        : "offline";
  const expires = session.credentialExpiresAt
    ? Date.parse(session.credentialExpiresAt)
    : Number.NaN;
  const expiresIn = Number.isNaN(expires) ? null : expires - serverNowMs;
  const credential: CredentialState = session.credentialRevoked
    ? "revoked"
    : expiresIn === null
      ? "none"
      : expiresIn <= 0
        ? "expired"
        : expiresIn <= CREDENTIAL_EXPIRING_SOON_MS
          ? "expiring-soon"
          : "valid";
  return {
    status,
    lastContactAt: session.lastHeartbeatAt,
    ageMs,
    credential,
    credentialExpiresInMs: expiresIn,
  };
}
