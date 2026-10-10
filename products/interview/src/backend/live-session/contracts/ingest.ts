// The typed inputs and outputs of ingest. The wire shapes (envelope kinds,
// acknowledgements, control, limits) are @omnitech/active-session-contracts';
// this file adds only what the server side needs around them.
import type {
  Acknowledgement,
  ActiveSessionLimits,
  CompanionDeclaration,
  ControlStatus,
  ObservationIssue,
  RefusalCode,
} from "@omnitech/active-session-contracts";
import type { TenantDatabase } from "@omnitech/database";
import type { SessionStatus } from "../core/index";
import type { OwnerScope } from "../scope";
import type { SessionJobs } from "../session-jobs";
import type { SessionRecord } from "../session-record";
import type { VoiceActivityGate } from "../voice-activity";
import type { HeardLine, VoiceActivityHeard } from "./events";

export type IngestLimits = {
  -readonly [K in keyof ActiveSessionLimits]: number;
};

// What travels with one request, beside its envelope.
export type IngestRequestOptions = {
  // The screenshot's bytes, which travel apart from the envelope.
  payload?: Uint8Array;
  // What the companion declared on this request (negotiation.ts). Absent reads
  // as an older companion: it is never handed a capture request and a capture
  // request is never promised to it.
  declaration?: CompanionDeclaration;
};

// What the host gives ingest: the job repository, the owner's switch and the
// listeners told after the commit.
export type IngestDependencies = {
  jobs?: SessionJobs;
  // Told how long a rate_limited refusal asks the companion to wait, so the
  // route can answer Retry-After (a spacing refusal is seconds, not a minute).
  onRetryAfter?: (seconds: number) => void;
  // Told each transcript line a session stored, after it is committed. The
  // line says whether its session may be processed off this device: a coach
  // on a remote model reads only those; the owner's own recording, which
  // stays on this machine, may keep any.
  onHeard?: (heard: HeardLine) => void;
  // Whether this Studio takes voice activity at all (the owner's switch).
  // Absent or false: a report is refused voice_activity_off and told to nobody.
  // A function is asked at every report, so a change in Settings applies to
  // the next one without a restart.
  voiceActivity?: boolean | (() => boolean);
  // Told that an audio source of a session started or stopped hearing a
  // voice. [SAFETY] Only ever for a session whose owner allows processing off
  // this device: a device-only session's activity is told to nobody.
  onActivity?: (activity: VoiceActivityHeard) => void;
};

// Overrides for tests only; production uses the frozen contract constants and
// the process's own gate.
export type IngestTestSeams = {
  limits?: Partial<IngestLimits>;
  // The bound on how often a session's activity reports are taken.
  activityGate?: VoiceActivityGate;
};

export type IngestOptions = IngestRequestOptions &
  IngestDependencies &
  IngestTestSeams;

export type Refused = Extract<Acknowledgement, { status: "refused" }>;

// A refusal before it is an acknowledgement: what a domain decision returns.
export type RefusalReason = {
  code: RefusalCode;
  issues?: ObservationIssue[];
};

// What one message came to inside its transaction: the answer, and what is to
// be told once it is committed.
export type IngestOutcome = {
  ack: Acknowledgement;
  cancelJobs: boolean;
  heard?: HeardLine;
  activity?: VoiceActivityHeard;
  retryAfterSeconds?: number;
};

// What every handler is given: the open transaction, the locked session as it
// stands now, and the answer's control state.
export type IngestContext = {
  tx: TenantDatabase;
  scope: OwnerScope;
  session: SessionRecord;
  status: SessionStatus;
  control: ControlStatus;
  // The refusal the session's standing gives ingest, or null while capturing.
  closed: RefusalCode | null;
  // True when this contact changed the session's standing (see reconcile).
  cancelJobs: boolean;
  limits: IngestLimits;
  declaration: CompanionDeclaration;
  payload: Uint8Array | undefined;
  voiceActivity: IngestDependencies["voiceActivity"];
  activityGate: VoiceActivityGate | undefined;
};

export type IngestHandler = (
  context: IngestContext,
  envelope: unknown,
) => IngestOutcome | Promise<IngestOutcome>;
