// The Setup form as plain data: its defaults, how it becomes the strict start
// request, the matrix options, and what each start failure says. No React here,
// so the rules (consent, one source, strict rehearsal) are tested directly.
import type {
  LiveCaptureSource,
  LiveProcessingPolicy,
  LiveRetentionMode,
  LiveSessionChoicesResponse,
  LiveSessionStartRequest,
} from "@omnitech/interview-contracts";
import type { SessionErrorCode } from "./session-client";

type ProfileChoice = LiveSessionChoicesResponse["profiles"][number];

export type SetupTarget =
  | { kind: "rehearsal" }
  // candidacyId alone: a candidacy with no interview yet.
  | { kind: "candidacy"; candidacyId: string }
  // An interview is agreed only through its candidacy: both ids go to start.
  | { kind: "interview"; candidacyId: string; interviewId: string };

// Where Studio hears and sees from. It only chooses the default sources: the
// start request carries sources, never the host.
export type SetupHost = "mac" | "browser";

export type SetupForm = {
  host: SetupHost;
  // null until the owner picks what the session is for.
  target: SetupTarget | null;
  // Rehearsal only. Strict turns live assistance off.
  strict: boolean;
  // Confirmed on this screen; the start request has no agreement field, so
  // nothing here claims it is recorded.
  consent: boolean;
  sources: readonly LiveCaptureSource[];
  assistance: boolean;
  // "none", or "<profileId>@<revision>".
  matrix: string;
  policy: LiveProcessingPolicy;
  retention: LiveRetentionMode;
};

export const SOURCE_ORDER: readonly LiveCaptureSource[] = [
  "microphone",
  "application-audio",
  "screen",
];

// The Mac app hears both sides and sees the screen; a plain browser cannot
// capture app audio, so it starts from the microphone and the screen.
export const HOST_SOURCES: Record<SetupHost, readonly LiveCaptureSource[]> = {
  mac: ["microphone", "application-audio", "screen"],
  browser: ["microphone", "screen"],
};

export function initialForm(host: SetupHost): SetupForm {
  return {
    host,
    target: null,
    strict: false,
    consent: false,
    sources: HOST_SOURCES[host],
    assistance: true,
    matrix: "none",
    // Allow remote is the default so hands-free works (screenshots, code,
    // answers). The owner can switch to Device only before start; a remembered
    // choice overrides this. After start it can only be tightened (ADR-0012).
    policy: "permitted-remote",
    retention: "delete-at-end",
  };
}

// ---- Matrix selector -------------------------------------------------------

export type MatrixOption = { value: string; label: string };

const roles = (count: number) => `${count} role${count === 1 ? "" : "s"}`;

// The latest revision of each matrix first (it is what "latest" pins), then
// older revisions, newest first as the server lists them.
export function matrixOptions(
  profiles: readonly ProfileChoice[],
): MatrixOption[] {
  const ordered = [
    ...profiles.filter((profile) => profile.latest),
    ...profiles.filter((profile) => !profile.latest),
  ];
  return ordered.map((profile) => ({
    value: `${profile.profileId}@${profile.revision}`,
    label: profile.latest
      ? `${profile.name} · latest (revision ${profile.revision}, ${roles(profile.entryCount)})`
      : `${profile.name} · revision ${profile.revision} (${roles(profile.entryCount)})`,
  }));
}

export function defaultMatrix(profiles: readonly ProfileChoice[]): string {
  return matrixOptions(profiles)[0]?.value ?? "none";
}

// ---- Why Start is blocked --------------------------------------------------

// The first thing in the way of Start, as one sentence, or null when ready.
// Checked in the order the page asks for things.
export function startBlocker(
  form: SetupForm,
  deviceOnlyBlock: string | null,
): string | null {
  if (!form.target) return "Choose what the session is for.";
  if (form.sources.length === 0) return "Choose at least one source.";
  if (!form.consent) return "Confirm everyone has agreed.";
  return form.policy === "device-only" ? deviceOnlyBlock : null;
}

// ---- The start request -----------------------------------------------------

// Null until the form may start: a target, the consent box and one source.
export function buildStartRequest(
  form: SetupForm,
  rehearsalRunId: string,
  profiles: readonly ProfileChoice[],
): LiveSessionStartRequest | null {
  if (!form.target || !form.consent || form.sources.length === 0) return null;
  const strict = form.target.kind === "rehearsal" && form.strict;
  const request: LiveSessionStartRequest = {
    processingPolicy: form.policy,
    captureSources: SOURCE_ORDER.filter((source) =>
      form.sources.includes(source),
    ),
    // The server also forces this off in a strict rehearsal
    // (rule:strict-rehearsal-no-assistance).
    liveAssistance: strict ? false : form.assistance,
    retention: form.retention,
  };
  if (form.target.kind === "rehearsal") {
    request.rehearsal = { runId: rehearsalRunId, strict };
  } else {
    request.candidacyId = form.target.candidacyId;
    if (form.target.kind === "interview")
      request.interviewId = form.target.interviewId;
  }
  const chosen = profiles.find(
    (profile) => `${profile.profileId}@${profile.revision}` === form.matrix,
  );
  // The revision the owner saw is the revision pinned.
  if (chosen)
    request.profile = { id: chosen.profileId, revision: chosen.revision };
  return request;
}

// A client-minted opaque id for a rehearsal run (ADR-0012 Rehearsal).
export function newRehearsalRunId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return (
    random ??
    `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

// ---- Failures --------------------------------------------------------------

// A fixed sentence per code; never a server message.
export function startErrorMessage(code: SessionErrorCode): string {
  switch (code) {
    case "open_session_exists":
      return "You already have an open live session. Open it, or end it before starting another.";
    case "link_refused":
      return "That interview or matrix is no longer available to you. Choose again; the list has been reloaded.";
    case "invalid_input":
      return "Studio could not accept these settings. Check the sources and try again.";
    case "unauthorized":
      return "You are signed out, or not allowed to start sessions here. Sign in again and retry.";
    case "network":
      return "Studio couldn’t reach the session service. Nothing was started. Try again.";
    default:
      return `Studio couldn’t start the session (${code}). Nothing was started. Try again.`;
  }
}
