// Id-only operational traces of the session processor (rule:id-only-traces).
// An event holds ids, revisions, the fence, the profile and locality decision,
// durations, an outcome code and byte counts - never a question, transcript,
// prompt, draft, credential or a hash of any content. The sink re-checks that
// on the way out, so even a careless caller cannot put a free-text value into
// a line: every string must be id-shaped or a code, or it is replaced.
import { HANDLE_PATTERN } from "./core/index.js";

export type LocalityDecision = "device-only" | "permitted-remote" | "none";

export type SessionTraceEvent = {
  event: string;
  sessionId: string;
  tenantId: string;
  taskId?: string;
  revision?: number;
  fence: number;
  profileId?: string;
  localityDecision: LocalityDecision;
  durationMs: number;
  // A short code such as "published" or "policy-refused".
  outcome: string;
  byteCounts: { input: number; output: number };
  // Extra ids, counts and codes (for example a suppression reason or a
  // validation path); the same id-shape rule applies to every string.
  detail?: Readonly<Record<string, string | number | boolean>>;
};

export interface TraceSink {
  emit(event: SessionTraceEvent): void;
}

const CODE_PATTERN = /^[a-z0-9_.:-]{1,64}$/;
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
// A validation path such as "sections.0.kind:invalid_value" or "$:invalid_type".
const PATH_PATTERN = /^[A-Za-z0-9_.$:-]{1,96}$/;

const idOrRedacted = (value: string): string =>
  HANDLE_PATTERN.test(value) ? value : "[redacted]";
const codeOrRedacted = (value: string): string =>
  CODE_PATTERN.test(value) ? value : "invalid_code";

const count = (value: number): number =>
  Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

// The event as it may leave the process.
export function sanitizeTrace(event: SessionTraceEvent): SessionTraceEvent {
  const detail: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(event.detail ?? {})) {
    if (!KEY_PATTERN.test(key)) continue;
    detail[key] =
      typeof value === "string"
        ? PATH_PATTERN.test(value)
          ? value
          : "[redacted]"
        : typeof value === "number"
          ? count(value)
          : value;
  }
  return {
    event: codeOrRedacted(event.event),
    sessionId: idOrRedacted(event.sessionId),
    tenantId: idOrRedacted(event.tenantId),
    ...(event.taskId === undefined
      ? {}
      : { taskId: idOrRedacted(event.taskId) }),
    ...(event.revision === undefined
      ? {}
      : { revision: count(event.revision) }),
    fence: count(event.fence),
    ...(event.profileId === undefined
      ? {}
      : { profileId: idOrRedacted(event.profileId) }),
    localityDecision: event.localityDecision,
    durationMs: count(event.durationMs),
    outcome: codeOrRedacted(event.outcome),
    byteCounts: {
      input: count(event.byteCounts.input),
      output: count(event.byteCounts.output),
    },
    ...(Object.keys(detail).length === 0 ? {} : { detail }),
  };
}

// The default sink: one JSON line of ids and codes per event, written through
// a provided logger function.
export function createLoggerTraceSink(log: (line: string) => void): TraceSink {
  return {
    emit(event) {
      log(JSON.stringify(sanitizeTrace(event)));
    },
  };
}

export const silentTraceSink: TraceSink = { emit: () => undefined };
