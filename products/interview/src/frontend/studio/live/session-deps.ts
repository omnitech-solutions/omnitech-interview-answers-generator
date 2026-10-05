// What the session store needs from the page, and its cadence. Injected so
// tests can supply a scripted fetch, a clock, visibility and storage.
import type {
  LiveCaptureState,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import type {
  ApplyContextInput,
  CaptureInput,
  CompanionCaptureInput,
  OwnerHints,
} from "./session-capture";
import type { SessionFetch } from "./session-client";
import type { TaskTarget } from "./shared/task-target";

// Cadence: a live session is read about once a second; a paused one rarely
// changes, so every 5 s; failures back off from 5 s to 30 s.
export const POLL_ACTIVE_MS = 1_000;
export const POLL_PAUSED_MS = 5_000;
export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 30_000;
// A purging session is re-read until the purge finishes, at most this often.
export const PURGE_SETTLE_MS = 3_000;
export const PURGE_SETTLE_ATTEMPTS = 20;

// Owner input over the one session, shared by what the page injects (StoreDeps)
// and what the commands call (CommandContext).
export type OwnerInputPort = {
  // Owner input over the one session: ask for an answer from the newest
  // capture, or send a typed follow-up. The server route is optional until it
  // ships; a missing method is answered with the "unavailable" code. Failures
  // are thrown as SessionApiError. The text is never logged or stored here.
  analyzeLatestCapture?(
    sessionId: string,
    target?: TaskTarget,
    hints?: OwnerHints,
    // The stored capture the owner chose; without it, the newest one.
    snapshot?: { sourceId: string; eventId: string },
  ): Promise<void>;
  // Capture and analyze: the browser's own fresh frame.
  analyzeCapture?(sessionId: string, input: CaptureInput): Promise<void>;
  // Ask the native companion to capture once, and read how that request stands.
  requestCapture?(
    sessionId: string,
    input: CompanionCaptureInput,
  ): Promise<LiveCaptureState>;
  captureStatus?(
    sessionId: string,
    requestId: string,
  ): Promise<LiveCaptureState>;
  // `target` is the task revision the question is about; null is an explicit
  // general question (no task exists yet), never a stand-in for another task.
  submitFollowUp?(
    sessionId: string,
    text: string,
    target: TaskTarget | null,
    hints?: OwnerHints,
  ): Promise<void>;
  // Generate the solution code for one task revision. Idempotent: the same
  // task revision always carries the same request id.
  solveTask?(
    sessionId: string,
    target: TaskTarget,
    hints?: OwnerHints,
  ): Promise<void>;
  // Regenerate one task revision (a new revision of the same task, same
  // sources). Idempotent: the same task revision always carries the same
  // request id.
  regenerateTask?(sessionId: string, target: TaskTarget): Promise<void>;
  // Apply staged images as one request (see ApplyContextInput).
  applyContext?(
    sessionId: string,
    target: TaskTarget | null,
    input: ApplyContextInput,
  ): Promise<void>;
  // Hands-free Auto: one final phrase the browser heard, by its own request id
  // (a retry of the same phrase reuses it). Never logged or stored here.
  submitHeard?(
    sessionId: string,
    text: string,
    requestId: string,
  ): Promise<void>;
};

export type StoreDeps = OwnerInputPort & {
  fetch: SessionFetch;
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  isVisible(): boolean;
  // Calls back when the page becomes visible or hidden; returns the remover.
  onVisibilityChange(listener: () => void): () => void;
  // Only the finished session's id is ever stored; failures are the caller's.
  storage: {
    read(key: string): string | null;
    write(key: string, value: string): void;
    remove(key: string): void;
  };
};

// Created, active and paused: the session is still the owner's to run.
export const isOpenSession = (session: LiveSessionView | null): boolean =>
  session !== null &&
  (session.status === "created" ||
    session.status === "active" ||
    session.status === "paused");
