// The shapes the session store publishes. Every UI unit reads LiveSnapshot (or
// the view model derived from it); none of them calls the routes directly.
import type {
  LiveAction,
  LiveCredential,
  LiveObservation,
  LiveRetentionMode,
  LiveSessionStartRequest,
  LiveSessionView,
} from "@omnitech/interview-contracts";
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
  | "delete";

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
  // Commands in flight, and the last command's failure (cleared by the next).
  pending: readonly SessionCommand[];
  commandError: SessionErrorCode | null;
  // The finished session the ended view reads, remembered across a reload for
  // this browser tab (the id only; sessionStorage).
  endedSessionId: string | null;
  // An id asked for by address (live/<id>) that the server does not know.
  notFoundSessionId: string | null;
};

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
  // Forget the held credential (the owner has handed it over).
  dismissPairing(): void;
  // Leave a finished session's summary for a fresh setup. Only a finished
  // session is dismissed; an open one is never dropped from the browser.
  dismissFinished(): void;
  // Track a session by id (a finished one addressed as live/<id>).
  openSession(sessionId: string): Promise<void>;
  // Read the current session again.
  refresh(): Promise<void>;
};

export type SessionStore = {
  // useSyncExternalStore pair. The first subscriber hydrates the store.
  subscribe(listener: () => void): () => void;
  getSnapshot(): LiveSnapshot;
  actions: SessionActions;
  // Cancel timers and drop listeners; the store is not used afterwards.
  dispose(): void;
};
