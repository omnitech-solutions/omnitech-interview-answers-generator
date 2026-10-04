// What the session store needs from the page, and its cadence. Injected so
// tests can supply a scripted fetch, a clock, visibility and storage.
import type { LiveSessionView } from "@omnitech/interview-contracts";
import type { SessionFetch } from "./session-client";

// Cadence: a live session is read about once a second; a paused one rarely
// changes, so every 5 s; failures back off from 5 s to 30 s.
export const POLL_ACTIVE_MS = 1_000;
export const POLL_PAUSED_MS = 5_000;
export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 30_000;
// A purging session is re-read until the purge finishes, at most this often.
export const PURGE_SETTLE_MS = 3_000;
export const PURGE_SETTLE_ATTEMPTS = 20;

export type StoreDeps = {
  fetch: SessionFetch;
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  isVisible(): boolean;
  // Calls back when the page becomes visible or hidden; returns the remover.
  onVisibilityChange(listener: () => void): () => void;
  // Owner input over the one session: ask for an answer from the newest
  // capture, or send a typed follow-up. The server route is optional until it
  // ships; a missing method is answered with the "unavailable" code. Failures
  // are thrown as SessionApiError. The text is never logged or stored here.
  analyzeLatestCapture?(sessionId: string): Promise<void>;
  submitFollowUp?(sessionId: string, text: string): Promise<void>;
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
