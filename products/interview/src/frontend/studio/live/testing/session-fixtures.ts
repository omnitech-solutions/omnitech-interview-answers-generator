// Synthetic builders for the Live session tests (client, store, derivation and
// every view). Names are placeholders only: Interviewer, Candidate, Example
// Corp. Nothing here is a real transcript, employer or figure.
import type {
  LiveAction,
  LiveCompanionCapability,
  LiveObservation,
  LiveSessionView,
  LiveStreamResponse,
} from "@omnitech/interview-contracts";

export const SESSION_ID = "0b1f6a52-7c7e-4f0e-9e1b-2c3d4e5f6a7b";
const T0 = "2026-10-03T12:00:00.000Z";

export function minutesAfter(minutes: number, seconds = 0): string {
  return new Date(
    Date.parse(T0) + (minutes * 60 + seconds) * 1000,
  ).toISOString();
}

export function sessionView(
  overrides: Partial<LiveSessionView> = {},
): LiveSessionView {
  return {
    id: SESSION_ID,
    status: "active",
    retention: "delete-at-end",
    processingPolicy: "device-only",
    createdAt: T0,
    expiresAt: minutesAfter(240),
    credentialExpiresAt: minutesAfter(120),
    credentialRevoked: false,
    captureSources: ["microphone", "application-audio"],
    liveAssistance: true,
    strict: false,
    rehearsalRunId: null,
    interviewId: null,
    candidacyId: null,
    profile: { id: "profile-1", revision: 3 },
    workspaceDraft: null,
    lastHeartbeatAt: null,
    endedAt: null,
    purged: false,
    purgeOutcome: null,
    shownDraftCount: 0,
    ...overrides,
  };
}

// The shape the server stores and the stream returns: the companion's own
// clock and sequence around the wire content (ingest.ts).
export function stored(
  sequence: number,
  body: unknown,
): LiveObservation["content"] {
  return {
    occurredAt: minutesAfter(0, sequence),
    sourceSequence: sequence,
    body,
  };
}

export function transcript(
  sequence: number,
  text: string,
  overrides: Partial<LiveObservation> & {
    speaker?: string;
    sourceId?: string;
  } = {},
): LiveObservation {
  const {
    speaker = "speaker-1",
    sourceId = "application-audio",
    ...rest
  } = overrides;
  return {
    sequence,
    sourceId,
    eventId: `evt-${sequence}`,
    kind: "transcript.final",
    receivedAt: minutesAfter(0, sequence),
    content: stored(sequence, {
      speaker,
      text,
      startMs: sequence * 1000,
      endMs: sequence * 1000 + 800,
    }),
    screenshotArtifactId: null,
    ...rest,
  };
}

export function disconnected(
  sequence: number,
  source: "microphone" | "application-audio" | "screen",
  reason: "user-stopped" | "permission-revoked" | "device-lost" | "error",
  sourceId: string = source,
): LiveObservation {
  return {
    sequence,
    sourceId,
    eventId: `evt-${sequence}`,
    kind: "source.disconnected",
    receivedAt: minutesAfter(0, sequence),
    content: stored(sequence, { source, reason }),
    screenshotArtifactId: null,
  };
}

export function gap(
  sequence: number,
  source: "microphone" | "application-audio" | "screen",
  reason: "buffer-overflow" | "source-interrupted" | "paused" | "error",
  durationMs = 4000,
  sourceId: string = source,
): LiveObservation {
  return {
    sequence,
    sourceId,
    eventId: `evt-${sequence}`,
    kind: "capture.gap",
    receivedAt: minutesAfter(0, sequence),
    content: stored(sequence, { source, durationMs, reason }),
    screenshotArtifactId: null,
  };
}

export function snapshot(
  sequence: number,
  windowLabel = "Editor window",
): LiveObservation {
  return {
    sequence,
    sourceId: "screen",
    eventId: `evt-${sequence}`,
    kind: "screen.snapshot",
    receivedAt: minutesAfter(0, sequence),
    content: stored(sequence, {
      payloadRef: `shot-${sequence}`,
      mediaType: "image/png",
      byteLength: 1200,
      windowLabel,
    }),
    screenshotArtifactId: `artifact-${sequence}`,
  };
}

let actionCounter = 0;
function actionId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function action(overrides: Partial<LiveAction> = {}): LiveAction {
  actionCounter += 1;
  return {
    id: actionId(actionCounter),
    taskId: "task-1",
    taskRevision: 1,
    actionKind: "draft-answer",
    dispatchStatus: "succeeded",
    attempt: 1,
    fenceAtDispatch: 1,
    jobId: null,
    jobCreated: false,
    result: null,
    shown: false,
    suppressionReason: null,
    createdAt: minutesAfter(1),
    updatedAt: minutesAfter(1, 5),
    ...overrides,
  };
}

export function streamPage(
  overrides: Partial<LiveStreamResponse> = {},
): LiveStreamResponse {
  return {
    session: sessionView(),
    observations: [],
    actions: [],
    nextAfterSequence: 0,
    nextActionCursor: "cursor-0",
    hasMoreObservations: false,
    hasMoreActions: false,
    serverNow: minutesAfter(1),
    ...overrides,
  };
}

// A JSON Response for an injected fetch.
export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// The companion's last capability report as the route returns it (the shape is
// parsed by liveCompanionCapabilitySchema in the client, so a wrong one fails).
export function capabilityReport(
  overrides: {
    speech?: Partial<LiveCompanionCapability["speech"]>;
    permissions?: Partial<LiveCompanionCapability["permissions"]>;
    reportedAt?: string;
    captureRequests?: boolean;
    screenSelection?: string;
  } = {},
): LiveCompanionCapability {
  return {
    ...(overrides.captureRequests !== undefined
      ? { captureRequests: overrides.captureRequests }
      : {}),
    ...(overrides.screenSelection !== undefined
      ? { screenSelection: overrides.screenSelection }
      : {}),
    reportedAt: overrides.reportedAt ?? minutesAfter(0),
    speech: {
      locale: "en-GB",
      onDeviceAvailable: true,
      recognizerAvailable: true,
      authorizationStatus: "authorized",
      ...overrides.speech,
    },
    permissions: {
      microphone: "granted",
      screen: "granted",
      ...overrides.permissions,
    },
  };
}
export const READY_REPORT = capabilityReport();
