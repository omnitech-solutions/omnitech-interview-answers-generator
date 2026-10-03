// How the Rehearsal scorecard picks up the hints of a live session. Setup mints
// an opaque rehearsal run id and the session records it (ADR-0012
// rule:strict-rehearsal-no-assistance, rule:assistance-counts-as-hints). The
// scorecard save sends that id; the SERVER counts the shown drafts, so the
// browser never reports a count and the Rehearsal flow stays the only
// scorecard writer (rule:no-second-scorecard).
import type { LiveSessionView } from "@omnitech/interview-contracts";
import { getSessionStore, tenantFromLocation } from "./session-registry";

export type RehearsalRunLink =
  // No rehearsal session to count: the save carries no run id.
  | { kind: "none" }
  // Send `runId`. `open`: the session was still open at the save, so a draft
  // shown after it is not counted (a run id derives once).
  | { kind: "linked"; runId: string; open: boolean }
  // The session and this rehearsal disagree on strict, which the server
  // refuses for the whole save: leave the id out and say so.
  | { kind: "strictness-mismatch" };

// A run id that has been saved. The server derives hints once per run id and
// refuses the second save, so it is sent once. The ended session is re-read
// after a reload, so the saved ids live in this tab's sessionStorage next to
// it (ids only; storage is optional, so every access is guarded).
const SAVED_KEY = "interview-studio.live.saved-rehearsal-runs";
const MAX_SAVED = 50;
let saved: Set<string> | null = null;

function savedRuns(): Set<string> {
  if (saved) return saved;
  saved = new Set();
  try {
    const raw = window.sessionStorage.getItem(SAVED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed))
      for (const id of parsed) if (typeof id === "string") saved.add(id);
  } catch {
    // No storage or unreadable: this page's memory is all there is.
  }
  return saved;
}

function persistSaved(runs: ReadonlySet<string>): void {
  try {
    window.sessionStorage.setItem(
      SAVED_KEY,
      JSON.stringify([...runs].slice(-MAX_SAVED)),
    );
  } catch {
    // Storage is optional; the server still refuses a repeat.
  }
}

export function forgetSavedRehearsalRuns(): void {
  saved = new Set();
  try {
    window.sessionStorage.removeItem(SAVED_KEY);
  } catch {
    // Nothing to remove.
  }
}

export function markRehearsalRunSaved(runId: string): void {
  const runs = savedRuns();
  runs.add(runId);
  persistSaved(runs);
}

export function linkRehearsalRun(
  session: LiveSessionView | null,
  strict: boolean,
): RehearsalRunLink {
  const runId = session?.rehearsalRunId;
  if (!session || !runId || savedRuns().has(runId)) return { kind: "none" };
  if (session.strict !== strict) return { kind: "strictness-mismatch" };
  return {
    kind: "linked",
    runId,
    open: session.status !== "ended" && session.status !== "purging",
  };
}

// The session this tab's store holds right now. Reading does not subscribe, so
// it neither starts the poll nor keeps it alive: the Studio shell does that.
export function currentRehearsalLink(strict: boolean): RehearsalRunLink {
  return linkRehearsalRun(
    getSessionStore(tenantFromLocation()).getSnapshot().session,
    strict,
  );
}
