// Ports the neutral session core needs from its host (rule:neutral-core-imports).
// The product supplies implementations; the core never reaches for I/O, time or
// randomness itself, and never decides what an utterance means.

// Injected wall clock. Core functions take `nowMs` explicitly; callers read it here.
export interface Clock {
  nowMs(): number;
}

// Injected id source so task ids are deterministic under test.
// `stableKey`, when given, is a source-derived key the id must be built from,
// so the same source yields the same id however the run was paced or rebuilt.
export interface IdGenerator {
  next(prefix: string, stableKey?: string): string;
}

// An opaque, id-shaped handle. The policy names tasks and topics only by handle,
// so no utterance text can ride along inside a decision (rule:id-only-traces).
export const HANDLE_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const isOpaqueHandle = (value: string): boolean =>
  HANDLE_PATTERN.test(value);

export type SegmentClass =
  | "substantive"
  | "backchannel"
  | "filler"
  | "monologue";

export type RevisionReason = "constraint_changed" | "follow_up" | "correction";

export type TaskDecision =
  | { kind: "ignore" }
  | { kind: "open"; taskKey: string }
  | { kind: "revise"; taskId: string; reason: RevisionReason }
  | { kind: "defer"; topic: string }
  | { kind: "resume-deferred"; topic: string };

// One effective utterance: consecutive same-speaker segments already coalesced.
// `text` is passed through to the policy and never inspected by the core.
export type Utterance = {
  id: string;
  speaker: string;
  segmentIds: readonly string[];
  startMs: number;
  endMs: number;
  text: string;
  // The coalesced segments one by one, so the policy can name a task after
  // the segment that carries the question rather than the utterance's start.
  // `originId` is the first segment of the segment's correction chain.
  parts?: readonly { id: string; originId: string; text: string }[];
};

export type OpenTaskSummary = {
  taskId: string;
  taskKey: string;
  revision: number;
};

export type PolicyInput = {
  utterance: Utterance;
  openTasks: readonly OpenTaskSummary[];
  deferredTopics: readonly string[];
};

export type PolicyVerdict = {
  segmentClass: SegmentClass;
  decision: TaskDecision;
};

// Interview policy lives behind this port; the core enforces mechanics only.
export interface TaskPolicy {
  decide(input: PolicyInput): Promise<PolicyVerdict>;
}

// Content-free diagnostic record: ids and counts only (rule:id-only-traces).
export type TraceEvent = {
  event: string;
  ids: Readonly<Record<string, string | number | boolean>>;
};
