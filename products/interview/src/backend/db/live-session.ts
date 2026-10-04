// Active Session persistence (ADR-0011, ADR-0012). Tables are owned by
// Interview and carry tenant and owner ids under forced row security that
// binds both (rule:actor-private-session-rows); every child references its
// session by tenant, owner and session id (rule:composite-owner-references).
// Triggers, the claim view, the credential-lookup and purge settings and the
// session artifact policies are hand-appended to the migration, as in
// Documents; this file declares the columns, keys and policies they sit on.

import {
  artifacts,
  tenantMemberships,
  tenants,
} from "@omnitech/platform-storage/schema";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { candidacies, interviews } from "./schema.js";
import { interview } from "./studio.js";

// The artifact type of a stored screenshot. The restrictive artifact policies
// of the Active Session migration name it (rule:private-session-artifact-types).
export const SESSION_SCREENSHOT_ARTIFACT_TYPE = "interview.session-screenshot";

const tenantScope = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`;
const actorIs = sql`owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid`;
const ownerScope = sql`${tenantScope} AND ${actorIs}`;
// Deleting session rows is the purge, which names one setting with one owning
// file (rule:purge-delete-setting).
const purgeOn = sql`current_setting('app.session_purge', true) = 'on'`;
const claimOn = sql`current_setting('app.session_worker', true) = 'on'`;

export const sessionStatuses = [
  "created",
  "active",
  "paused",
  "purging",
  "ended",
] as const;
export const retentionModes = [
  "delete_at_end",
  "thirty_days",
  "until_deleted",
] as const;
export const processingPolicies = ["device_only", "permitted_remote"] as const;
export const observationKinds = [
  "transcript.final",
  "screen.snapshot",
  "source.disconnected",
  "capture.gap",
  // DB-only (ADR-0016): the owner's own request for assistance. It is not
  // part of the capture wire and the companion credential cannot store it.
  "owner.input",
] as const;
// The reserved source id of `owner.input` observations. The capture wire
// refuses it as a sender's source id, and the CHECK below keeps the pairing
// exact, so a companion can never pre-claim an owner input's dedup key.
export const OWNER_INPUT_SOURCE_ID = "studio.owner-input";
// The reserved source id of the owner's own browser captures: `screen.snapshot`
// observations written only by the owner capture route. Ingest refuses it as a
// sender's source id; the CHECK below keeps it to stored screen snapshots.
export const OWNER_CAPTURE_SOURCE_ID = "studio.owner-capture";
// The reserved source id of the owner's own heard speech (ADR-0022):
// `transcript.final` observations written only by the owner input route.
// Ingest refuses it as a sender's source id.
export const OWNER_MICROPHONE_SOURCE_ID = "studio.owner-microphone";
export const dispatchStatuses = [
  "in_flight",
  "succeeded",
  "failed",
  "suppressed",
] as const;

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const activeSessions = interview.table.withRLS(
  "active_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    status: text("status").notNull().default("created"),
    retentionMode: text("retention_mode").notNull().default("delete_at_end"),
    // Recorded at start; only the session row decides it (ADR-0012 locality).
    processingPolicy: text("processing_policy").notNull(),
    // Per-session counter: every lease acquire raises it (ADR-0011 Fencing).
    fence: bigint("fence", { mode: "number" }).notNull().default(0),
    leaseHolderId: text("lease_holder_id"),
    leaseExpiresAt: timestamptz("lease_expires_at"),
    // One live credential per session, stored hashed (rule:credential-storage).
    credentialHash: text("credential_hash"),
    credentialExpiresAt: timestamptz("credential_expires_at"),
    credentialRevokedAt: timestamptz("credential_revoked_at"),
    // Start-time snapshot of the permitted capture sources.
    sources: jsonb("sources"),
    // Rehearsal link: an opaque run id minted by the client, and the strict
    // flag, both immutable (rule:strict-rehearsal-no-assistance).
    rehearsalRunId: text("rehearsal_run_id"),
    strict: boolean("strict").notNull().default(false),
    // Links, set only by insert (rule:immutable-privacy-columns). Drafts and
    // profile ids are text keys, checked in the same transaction.
    interviewId: uuid("interview_id"),
    candidacyId: uuid("candidacy_id"),
    profileId: text("profile_id"),
    profileRevision: bigint("profile_revision", { mode: "number" }),
    workspaceDraftId: text("workspace_draft_id"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    // The duration cap: the credential never outlives it.
    expiresAt: timestamptz("expires_at").notNull(),
    lastHeartbeatAt: timestamptz("last_heartbeat_at"),
    endedAt: timestamptz("ended_at"),
    // Tombstone: purged_at is set once a final check found zero content rows.
    purgeStartedAt: timestamptz("purge_started_at"),
    purgedAt: timestamptz("purged_at"),
    purgeOutcome: text("purge_outcome"),
    purgeCounts: jsonb("purge_counts"),
    // Content-free hint count the rehearsal save reads (rule:tombstone-keeps-hint-count).
    shownDraftCount: integer("shown_draft_count").notNull().default(0),
    // The highest observation sequence below which every transcript segment
    // was already handled by a holder (a number, never content): a rebuilt run
    // closes exactly those segments instead of evaluating them again against
    // task state they were never judged against. Only ever raised.
    processedThrough: bigint("processed_through", { mode: "number" }),
    // The ONE pending capture request (a one-shot "capture now" for the native
    // companion): mode, region, owner hints, status and expiry. Session
    // content, so the purge clears it with the other session fields.
    captureRequest: jsonb("capture_request"),
  },
  (t) => [
    unique("active_sessions_tenant_owner_id_key").on(
      t.tenantId,
      t.ownerUserId,
      t.id,
    ),
    // rule: one active session per owner. Ended and purging sessions free it.
    uniqueIndex("active_sessions_one_open_per_owner")
      .on(t.tenantId, t.ownerUserId)
      .where(sql`status NOT IN ('ended', 'purging')`),
    uniqueIndex("active_sessions_credential_hash_key")
      .on(t.credentialHash)
      .where(sql`credential_hash IS NOT NULL`),
    index("active_sessions_claim_idx").on(t.status, t.leaseExpiresAt),
    index("active_sessions_rehearsal_run_idx").on(
      t.tenantId,
      t.ownerUserId,
      t.rehearsalRunId,
    ),
    index("active_sessions_candidacy_idx").on(t.tenantId, t.candidacyId),
    index("active_sessions_interview_idx").on(t.tenantId, t.interviewId),
    foreignKey({
      name: "active_sessions_tenant_fkey",
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
    }),
    // ON DELETE RESTRICT: a linked candidacy or interview cannot be deleted
    // while a session that is not a tombstone (links still set) names it.
    foreignKey({
      name: "active_sessions_candidacy_fkey",
      columns: [t.tenantId, t.candidacyId],
      foreignColumns: [candidacies.tenantId, candidacies.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "active_sessions_interview_candidacy_fkey",
      columns: [t.tenantId, t.interviewId, t.candidacyId],
      foreignColumns: [
        interviews.tenantId,
        interviews.id,
        interviews.candidacyId,
      ],
    }).onDelete("restrict"),
    check("active_sessions_status_check", inList("status", sessionStatuses)),
    check(
      "active_sessions_retention_check",
      inList("retention_mode", retentionModes),
    ),
    check(
      "active_sessions_policy_check",
      inList("processing_policy", processingPolicies),
    ),
    check("active_sessions_fence_check", sql`fence >= 0`),
    check(
      "active_sessions_profile_pair_check",
      sql`(profile_id IS NULL) = (profile_revision IS NULL)`,
    ),
    check(
      "active_sessions_profile_revision_check",
      sql`profile_revision IS NULL OR profile_revision > 0`,
    ),
    // rule:credential-lifetime-and-renewal: never past the duration cap.
    check(
      "active_sessions_credential_cap_check",
      sql`credential_expires_at IS NULL OR credential_expires_at <= expires_at`,
    ),
    check(
      "active_sessions_credential_pair_check",
      sql`(credential_hash IS NULL) OR (credential_expires_at IS NOT NULL)`,
    ),
    check(
      "active_sessions_run_id_check",
      sql`rehearsal_run_id IS NULL OR char_length(rehearsal_run_id) BETWEEN 1 AND 128`,
    ),
    check("active_sessions_shown_check", sql`shown_draft_count >= 0`),
    check(
      "active_sessions_purge_outcome_check",
      sql`purge_outcome IS NULL OR purge_outcome IN ('complete', 'partial')`,
    ),
    check(
      "active_sessions_tombstone_check",
      sql`purged_at IS NULL OR (status = 'ended' AND purge_outcome IS NOT NULL)`,
    ),
    pgPolicy("active_sessions_owner_select", {
      for: "select",
      using: ownerScope,
    }),
    pgPolicy("active_sessions_owner_insert", {
      for: "insert",
      withCheck: ownerScope,
    }),
    pgPolicy("active_sessions_owner_update", {
      for: "update",
      using: ownerScope,
      withCheck: ownerScope,
    }),
    pgPolicy("active_sessions_owner_delete", {
      for: "delete",
      using: sql`${ownerScope} AND ${purgeOn}`,
    }),
    // The worker's cross-tenant claim (rule:session-claim-setting). Column
    // limits live in the active_sessions_claim_columns trigger
    // (rule:claim-writes-lease-and-fence-only).
    pgPolicy("active_sessions_claim_select", {
      for: "select",
      using: claimOn,
    }),
    pgPolicy("active_sessions_claim_update", {
      for: "update",
      using: claimOn,
      withCheck: claimOn,
    }),
    // Select-only: admits the one live row whose credential hash is presented,
    // in the tenant the route names (rule:credential-lookup-policy). An
    // unknown, expired and revoked credential are all just "no row".
    pgPolicy("active_sessions_credential_lookup", {
      for: "select",
      using: sql`${tenantScope} AND credential_hash IS NOT NULL AND credential_hash = nullif(current_setting('app.session_credential_hash', true), '') AND credential_revoked_at IS NULL AND credential_expires_at > now()`,
    }),
  ],
);

export const sessionObservations = interview.table.withRLS(
  "session_observations",
  {
    tenantId: uuid("tenant_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    sourceId: text("source_id").notNull(),
    eventId: text("event_id").notNull(),
    // Ordering inside the session, assigned by the repository under the
    // session-row lock.
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    // Final transcript text lives only here (rule:transcripts-in-observations).
    content: jsonb("content").notNull(),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
    // The original acknowledgement, so a resend returns it (rule:idempotent-observation).
    ack: jsonb("ack").notNull(),
    screenshotArtifactId: uuid("screenshot_artifact_id"),
  },
  (t) => [
    // Dedup by source and event id within the session.
    primaryKey({
      name: "session_observations_pkey",
      columns: [t.tenantId, t.ownerUserId, t.sessionId, t.sourceId, t.eventId],
    }),
    unique("session_observations_sequence_key").on(
      t.tenantId,
      t.ownerUserId,
      t.sessionId,
      t.sequence,
    ),
    index("session_observations_artifact_idx").on(
      t.tenantId,
      t.screenshotArtifactId,
    ),
    foreignKey({
      name: "session_observations_session_fkey",
      columns: [t.tenantId, t.ownerUserId, t.sessionId],
      foreignColumns: [
        activeSessions.tenantId,
        activeSessions.ownerUserId,
        activeSessions.id,
      ],
    }),
    foreignKey({
      name: "session_observations_artifact_fkey",
      columns: [t.tenantId, t.screenshotArtifactId],
      foreignColumns: [artifacts.tenantId, artifacts.id],
    }),
    check("session_observations_kind_check", inList("kind", observationKinds)),
    check("session_observations_sequence_check", sql`sequence >= 0`),
    check(
      "session_observations_owner_source_check",
      sql`(kind = 'owner.input') = (source_id = '${sql.raw(OWNER_INPUT_SOURCE_ID)}')`,
    ),
    check(
      "session_observations_owner_capture_check",
      sql`source_id <> '${sql.raw(OWNER_CAPTURE_SOURCE_ID)}' OR (kind = 'screen.snapshot' AND screenshot_artifact_id IS NOT NULL)`,
    ),
    check(
      "session_observations_artifact_kind_check",
      sql`screenshot_artifact_id IS NULL OR kind = 'screen.snapshot'`,
    ),
    pgPolicy("session_observations_owner_select", {
      for: "select",
      using: ownerScope,
    }),
    pgPolicy("session_observations_owner_insert", {
      for: "insert",
      withCheck: ownerScope,
    }),
    pgPolicy("session_observations_owner_delete", {
      for: "delete",
      using: sql`${ownerScope} AND ${purgeOn}`,
    }),
  ],
);

export const sessionActions = interview.table.withRLS(
  "session_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    taskId: text("task_id").notNull(),
    taskRevision: integer("task_revision").notNull(),
    actionKind: text("action_kind").notNull(),
    dispatchStatus: text("dispatch_status").notNull().default("in_flight"),
    attempt: integer("attempt").notNull().default(1),
    // Pre-generated and committed with the action before the job exists
    // (rule:action-before-job); job_created is set once the job row exists
    // and is then verified against tenant, owner and the private marker.
    jobId: uuid("job_id"),
    jobCreated: boolean("job_created").notNull().default(false),
    // The published result (a structured guide or draft); session content.
    result: jsonb("result"),
    fenceAtDispatch: bigint("fence_at_dispatch", { mode: "number" }).notNull(),
    // The transcript segment ids (event ids, never text) this task revision
    // was built on. A rebuilt run restores its task state and utterance
    // boundaries from them, so it closes exactly the utterances the live run
    // closed (null: a row written before the column existed).
    sourceEventIds: text("source_event_ids").array(),
    // Ids and codes only, never content (rule:id-only-traces).
    suppressionReason: text("suppression_reason"),
    shown: boolean("shown").notNull().default(false),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("session_actions_tenant_owner_id_key").on(
      t.tenantId,
      t.ownerUserId,
      t.id,
    ),
    // Dispatch dedup (rule:idempotent-dispatch): a failed or suppressed
    // dispatch may be retried; an in-flight or succeeded one may not.
    uniqueIndex("session_actions_dispatch_key")
      .on(
        t.tenantId,
        t.ownerUserId,
        t.sessionId,
        t.taskId,
        t.taskRevision,
        t.actionKind,
      )
      .where(sql`dispatch_status IN ('in_flight', 'succeeded')`),
    unique("session_actions_job_key").on(t.tenantId, t.jobId),
    index("session_actions_session_idx").on(
      t.tenantId,
      t.ownerUserId,
      t.sessionId,
    ),
    foreignKey({
      name: "session_actions_session_fkey",
      columns: [t.tenantId, t.ownerUserId, t.sessionId],
      foreignColumns: [
        activeSessions.tenantId,
        activeSessions.ownerUserId,
        activeSessions.id,
      ],
    }),
    check(
      "session_actions_status_check",
      inList("dispatch_status", dispatchStatuses),
    ),
    check("session_actions_revision_check", sql`task_revision >= 0`),
    check("session_actions_attempt_check", sql`attempt >= 1`),
    check("session_actions_fence_check", sql`fence_at_dispatch >= 0`),
    check(
      "session_actions_job_created_check",
      sql`NOT job_created OR job_id IS NOT NULL`,
    ),
    // Only a succeeded action carries a result, and only it can be shown.
    check(
      "session_actions_result_check",
      sql`(result IS NULL OR dispatch_status = 'succeeded') AND (NOT shown OR dispatch_status = 'succeeded')`,
    ),
    check(
      "session_actions_suppression_check",
      sql`dispatch_status <> 'suppressed' OR suppression_reason IS NOT NULL`,
    ),
    pgPolicy("session_actions_owner_select", {
      for: "select",
      using: ownerScope,
    }),
    pgPolicy("session_actions_owner_insert", {
      for: "insert",
      withCheck: ownerScope,
    }),
    pgPolicy("session_actions_owner_update", {
      for: "update",
      using: ownerScope,
      withCheck: ownerScope,
    }),
    pgPolicy("session_actions_owner_delete", {
      for: "delete",
      using: sql`${ownerScope} AND ${purgeOn}`,
    }),
  ],
);

export const capabilityPermissionStates = [
  "granted",
  "denied",
  "not-determined",
] as const;
export const speechAuthorizationStates = [
  "authorized",
  "denied",
  "restricted",
  "not-determined",
] as const;

// The capture companion's latest self-reported readiness for its owner: speech
// support and OS permission states, never content (a locale is a language tag).
// One row per (tenant, owner), replaced by each report. It is device capability,
// not session content, so a session purge deliberately leaves it; it is
// readable and writable only by its owner under forced row security. There is
// no delete policy: membership removal removes it through the composite
// reference to the tenant membership.
export const companionCapabilities = interview.table.withRLS(
  "companion_capabilities",
  {
    tenantId: uuid("tenant_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    reportedAt: timestamptz("reported_at").notNull().defaultNow(),
    speechLocale: text("speech_locale").notNull(),
    speechOnDeviceAvailable: boolean("speech_on_device_available").notNull(),
    speechRecognizerAvailable: boolean("speech_recognizer_available").notNull(),
    speechAuthorizationStatus: text("speech_authorization_status").notNull(),
    microphone: text("microphone").notNull(),
    screen: text("screen").notNull(),
    // What the companion declared on its ingest requests (ADR-0022): whether it
    // can take capture requests, and its token for the selected screen source.
    captureRequestSupport: boolean("capture_request_support")
      .notNull()
      .default(false),
    screenSelection: text("screen_selection"),
  },
  (t) => [
    check(
      "companion_capabilities_screen_selection_check",
      sql`screen_selection IS NULL OR screen_selection ~ '^[A-Za-z0-9._:-]{1,128}$'`,
    ),
    primaryKey({
      name: "companion_capabilities_pkey",
      columns: [t.tenantId, t.ownerUserId],
    }),
    foreignKey({
      name: "companion_capabilities_membership_fkey",
      columns: [t.tenantId, t.ownerUserId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
    }).onDelete("cascade"),
    check(
      "companion_capabilities_locale_check",
      sql`speech_locale ~ '^[A-Za-z0-9_-]{1,35}$'`,
    ),
    check(
      "companion_capabilities_speech_auth_check",
      inList("speech_authorization_status", speechAuthorizationStates),
    ),
    check(
      "companion_capabilities_microphone_check",
      inList("microphone", capabilityPermissionStates),
    ),
    check(
      "companion_capabilities_screen_check",
      inList("screen", capabilityPermissionStates),
    ),
    pgPolicy("companion_capabilities_owner_select", {
      for: "select",
      using: ownerScope,
    }),
    pgPolicy("companion_capabilities_owner_insert", {
      for: "insert",
      withCheck: ownerScope,
    }),
    pgPolicy("companion_capabilities_owner_update", {
      for: "update",
      using: ownerScope,
      withCheck: ownerScope,
    }),
  ],
);
