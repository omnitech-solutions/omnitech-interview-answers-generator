// The shapes the session store publishes. Every UI unit reads LiveSnapshot (or
// the view model derived from it); none of them calls the routes directly.
import type {
  LiveAction,
  LiveCaptureState,
  LiveCredential,
  LiveObservation,
  LiveRetentionMode,
  LiveSessionStartRequest,
  LiveSessionSummary,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import type {
  CaptureInput,
  CompanionCaptureInput,
  OwnerHints,
} from "./session-capture";
import type { SessionErrorCode } from "./session-client";

export type SessionCommand =
  | "start"
  | "pause"
  | "resume"
  | "end"
  | "renew"
  | "revoke"
  | "tighten"
  | "shorten"
  | "delete"
  | "analyze"
  | "follow-up"
  | "capture-request"
  | "switch";

export type LiveSnapshot = {
  tenant: string;
  // "pending": nothing asked yet. "loading": the first read is in flight.
  // "ready": the server's answer is held (session may still be null).
  // "failed": the first read did not complete; the store retries by itself.
  hydration: "pending" | "loading" | "ready" | "failed";
  // The server record is authoritative. null: no open session and no remembered
  // finished one. A finished session stays here (status ended / purging) so
  // the ended view can read it.
  session: LiveSessionView | null;
  // Everything read from the stream, merged: observations by sequence, actions
  // by id (newest updatedAt wins). Cleared when a session is purging.
  observations: readonly LiveObservation[];
  actions: readonly LiveAction[];
  // The credential from start or renewal, shown ONCE for the owner to hand to
  // the companion. It lives only in this field until dismissed or the page
  // reloads: never persisted, never logged, never re-read from the server.
  pairing: LiveCredential | null;
  // serverNow minus the browser clock at the last stream read (0 until one).
  serverClockOffsetMs: number;
  // Browser clock at the last successful stream read; null before one.
  lastReadAt: number | null;
  // The last stream or hydration failure while it persists; null when healthy.
  streamError: SessionErrorCode | null;
  // How many reads in a row have failed (0 once one succeeds). "Can't reach
  // Studio" is said only after a real run of failures, never for one blip.
  readFailures: number;
  // Commands in flight, and the last command's failure (cleared by the next).
  pending: readonly SessionCommand[];
  commandError: SessionErrorCode | null;
  // The finished session the ended view reads, remembered across a reload for
  // this browser tab (the id only; sessionStorage).
  endedSessionId: string | null;
  // The finished session the owner switched the store to, to read its ended
  // summary (followed until another is chosen, one starts or it is dismissed);
  // null otherwise.
  switchedTo: string | null;
  // An id asked for by address (live/<id>) that the server does not know.
  notFoundSessionId: string | null;
};

export type CaptureRequestResult =
  | { ok: true; state: LiveCaptureState }
  | { ok: false; code: SessionErrorCode };

export type CommandResult =
  | { ok: true }
  | { ok: false; code: SessionErrorCode };

// What the UI may do. Each command updates the snapshot from the server's
// response; a failure is returned as a code (and held in commandError).
export type SessionActions = {
  start(request: LiveSessionStartRequest): Promise<CommandResult>;
  pause(): Promise<CommandResult>;
  resume(): Promise<CommandResult>;
  // Idempotent on the server; the final stream page is read before polling
  // stops, so the ended view has the last transcript and results.
  end(): Promise<CommandResult>;
  renewCredential(): Promise<CommandResult>;
  revokeCredential(): Promise<CommandResult>;
  // Tighten only: after start the policy can move to device-only, never back.
  tightenLocality(): Promise<CommandResult>;
  // Shorten only: the server answers retention_lengthening_refused otherwise.
  shortenRetention(retention: LiveRetentionMode): Promise<CommandResult>;
  deleteSession(): Promise<CommandResult>;
  // Owner input: thin calls to the session deps. "unavailable" when the server
  // has no such route; "invalid_input" for an empty follow-up.
  analyzeLatestCapture(
    target?: { taskId: string; revision: number },
    hints?: OwnerHints,
  ): Promise<CommandResult>;
  // Capture and analyze: the frame the browser just took.
  analyzeCapture(input: CaptureInput): Promise<CommandResult>;
  // Ask the native companion to capture once. The answer carries the request's
  // state; poll captureStatus until it is no longer pending.
  requestCapture(input: CompanionCaptureInput): Promise<CaptureRequestResult>;
  captureStatus(requestId: string): Promise<CaptureRequestResult>;
  submitFollowUp(text: string, hints?: OwnerHints): Promise<CommandResult>;
  // Forget the held credential (the owner has handed it over).
  dismissPairing(): void;
  // Leave a finished session's summary for a fresh setup. Only a finished
  // session is dismissed; an open one is never dropped from the browser.
  dismissFinished(): void;
  // Track a session by id (a finished one addressed as live/<id>).
  openSession(sessionId: string): Promise<void>;
  // Read the current session again.
  refresh(): Promise<void>;
  // The owner's recent sessions, newest first (the session switcher's list).
  listSessions(): Promise<
    | { ok: true; sessions: readonly LiveSessionSummary[] }
    | { ok: false; code: SessionErrorCode }
  >;
  // Bind this one store to another of the owner's sessions. The previous
  // session's observations, actions and cursors are dropped; nothing is sent
  // to the session left behind, so a live one keeps running.
  switchSession(sessionId: string): Promise<CommandResult>;
};

export type SessionStore = {
  // useSyncExternalStore pair. The first subscriber hydrates the store.
  subscribe(listener: () => void): () => void;
  getSnapshot(): LiveSnapshot;
  actions: SessionActions;
  // Cancel timers and drop listeners; the store is not used afterwards.
  dispose(): void;
};
