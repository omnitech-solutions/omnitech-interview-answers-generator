// Owner input (ADR-0016 Decision 4): the owner's own request for assistance,
// "Analyze latest capture" or a typed follow-up. It is one product-owned
// observation kind, `owner.input`, stored DB-side only:
//   - it is NOT part of the capture wire (the wire union has no such kind and
//     the capture credential cannot store one; ingest refuses its source
//     namespace, see ingest.ts);
//   - it has its own reserved source id, so a companion can never pre-claim
//     its dedup key; the request id is its event id (dedup on request id);
//   - it is exempt from the capture caps and rate counters, and bounded by
//     its own per-session cap;
//   - screen evidence is named by exact snapshot observation ids that must be
//     screen snapshots of THIS session, never bytes or paths.
// Nothing here logs and no error carries content.

import type { PlatformDatabase, TenantDatabase } from "@omnitech/database";
import {
  type LiveOwnerInputRequest,
  liveHeardRequestSchema,
  liveOwnerInputRequestSchema,
} from "@omnitech/interview-contracts";
import { sql } from "drizzle-orm";
import {
  OWNER_INPUT_SOURCE_ID,
  OWNER_MICROPHONE_SOURCE_ID,
} from "../db/live-session";
import { canonicalJson } from "./canonical-json";
import { assertUuid, SessionError } from "./errors";
import { firstRow, inOwnerScope, type OwnerScope, rowsOf } from "./scope";
import { lockSession, type SessionRecord } from "./session-record";

// The stored body of an `owner.input` observation: the validated request
// without its id (the id is the observation's event id).
export type OwnerInputBody = Omit<LiveOwnerInputRequest, "requestId">;

// Owner inputs one session accepts. They are the owner's own typed or clicked
// requests, so the bound only stops a runaway client. 500 is far above a
// two-hour session's real use (one click or line every ~15 seconds) and keeps
// replay and the pending list small.
export const OWNER_INPUT_MAX_PER_SESSION = 500;

// The owner's "stop work" (control command `stop-work`): a stored, content-free
// marker in the observation stream, never accepted from the input route (its
// schema has no such operation). The holder applies it in observation order.
export const OWNER_STOP_OPERATION = "stop";
export const OWNER_STOP_BODY = {
  operation: OWNER_STOP_OPERATION,
} as unknown as OwnerInputBody;

export type OwnerInputAck = { requestId: string; sequence: number };

// Provenance ids: what a task revision rests on besides spoken segments. The
// ids are stored on the action row (source_event_ids), so replay, supersession
// and the purge work from them. `input/<request id>` names an owner input and
// `snap/<session>/<source>/<event>` a snapshot observation; neither can equal a
// spoken segment's event id because `/` is outside the wire's id alphabet.
export const ownerInputProvenanceId = (requestId: string): string =>
  `input/${requestId}`;
export const snapshotProvenanceId = (
  sessionId: string,
  sourceId: string,
  eventId: string,
): string => `snap/${sessionId}/${sourceId}/${eventId}`;
export const isSnapshotProvenanceId = (id: string): boolean =>
  id.startsWith("snap/");
export const isOwnerInputProvenanceId = (id: string): boolean =>
  id.startsWith("input/");

export function parseSnapshotProvenanceId(
  id: string,
): { sessionId: string; sourceId: string; eventId: string } | null {
  const parts = id.split("/");
  if (parts.length !== 4 || parts[0] !== "snap") return null;
  const [, sessionId, sourceId, eventId] = parts as [
    string,
    string,
    string,
    string,
  ];
  if (!sessionId || !sourceId || !eventId) return null;
  return { sessionId, sourceId, eventId };
}

// The lock-time checks every owner request shares: a live, purge-free session
// in a status that takes requests, with live assistance on.
export function assertAcceptsOwnerInput(
  row: SessionRecord | null | undefined,
): asserts row is SessionRecord {
  if (!row || row.purgedAt !== null) throw new SessionError("not_found");
  if (
    row.status !== "created" &&
    row.status !== "active" &&
    row.status !== "paused"
  )
    throw new SessionError("status_refused");
  // A session without live assistance (a strict rehearsal, or one started
  // with assistance off) answers nothing, so it takes no request for it.
  if (row.sources?.liveAssistance !== true)
    throw new SessionError("status_refused");
}

export const sameBody = (a: unknown, b: unknown): boolean =>
  canonicalJson(a) === canonicalJson(b);

// The stored owner input for a request id, if any.
export const findStoredOwnerInput = (
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  requestId: string,
) =>
  firstRow<{ sequence: string | number; content: unknown }>(
    tx,
    sql`SELECT sequence, content FROM interview.session_observations
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND owner_user_id = ${scope.actorId}::uuid
          AND session_id = ${sessionId}::uuid
          AND source_id = ${OWNER_INPUT_SOURCE_ID}
          AND event_id = ${requestId}`,
  );

// The per-session cap and the next sequence number.
export async function nextOwnerSequence(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  extra = 0,
): Promise<number> {
  const counts = await firstRow<{
    inputs: number;
    max_sequence: string | number;
  }>(
    tx,
    sql`SELECT (count(*) FILTER (WHERE kind = 'owner.input'))::int AS inputs,
               COALESCE(max(sequence), 0) AS max_sequence
        FROM interview.session_observations
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND owner_user_id = ${scope.actorId}::uuid
          AND session_id = ${sessionId}::uuid`,
  );
  if (Number(counts?.inputs ?? 0) + extra >= OWNER_INPUT_MAX_PER_SESSION)
    throw new SessionError("status_refused");
  return Number(counts?.max_sequence ?? 0) + 1;
}

export async function insertOwnerInput(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  row: SessionRecord,
  requestId: string,
  sequence: number,
  body: OwnerInputBody,
): Promise<OwnerInputAck> {
  const ack: OwnerInputAck = { requestId, sequence };
  await tx.execute(sql`
      INSERT INTO interview.session_observations
        (tenant_id, owner_user_id, session_id, source_id, event_id, sequence,
         kind, content, ack)
      VALUES (${scope.tenantId}::uuid, ${scope.actorId}::uuid, ${sessionId}::uuid,
        ${OWNER_INPUT_SOURCE_ID}, ${requestId}, ${sequence}, 'owner.input',
        ${JSON.stringify({
          occurredAt: new Date(row.nowMs).toISOString(),
          sourceSequence: 0,
          body,
        })}::jsonb,
        ${JSON.stringify(ack)}::jsonb)`);
  return ack;
}

// Heard speech per session: the owner's own recognised phrases, one row each.
// A two-hour interview is a few hundred phrases; the bound only stops a
// runaway client.
const OWNER_HEARD_MAX_PER_SESSION = 1_500;

// Stores one heard phrase (ADR-0022) as a `transcript.final` from the reserved
// owner microphone source, so the processor reads it like any heard speech.
// The row carries no `source` label: the browser microphone hears the room,
// the other side of the call included, so the policy must not treat it as the
// candidate's own speech. Idempotent by request id (the event id); a paused or
// finished session takes none.
async function storeHeard(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  request: { requestId: string; text: string },
): Promise<OwnerInputAck> {
  const { requestId, text } = request;
  return inOwnerScope(database, scope, async (tx) => {
    const row = await lockSession(tx, scope, sessionId);
    assertAcceptsOwnerInput(row);
    // [SAFETY] Speech is only heard while the session is capturing.
    if (row.status === "paused") throw new SessionError("status_refused");

    const stored = await firstRow<{
      sequence: string | number;
      content: unknown;
    }>(
      tx,
      sql`SELECT sequence, content FROM interview.session_observations
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid
            AND source_id = ${OWNER_MICROPHONE_SOURCE_ID}
            AND event_id = ${requestId}`,
    );
    if (stored) {
      const body = (stored.content as { body?: { text?: unknown } }).body;
      if (body?.text !== text) throw new SessionError("invalid_input");
      return { requestId, sequence: Number(stored.sequence) };
    }

    const counts = await firstRow<{
      heard: number;
      max_sequence: string | number;
    }>(
      tx,
      sql`SELECT (count(*) FILTER (WHERE source_id = ${OWNER_MICROPHONE_SOURCE_ID}))::int AS heard,
                 COALESCE(max(sequence), 0) AS max_sequence
          FROM interview.session_observations
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid`,
    );
    if (Number(counts?.heard ?? 0) >= OWNER_HEARD_MAX_PER_SESSION)
      throw new SessionError("status_refused");
    const sequence = Number(counts?.max_sequence ?? 0) + 1;
    // Media time is the time since the session was created, so utterances
    // coalesce and order as they would from a companion.
    const atMs = Math.max(0, row.nowMs - row.createdAt.getTime());
    const ack: OwnerInputAck = { requestId, sequence };
    await tx.execute(sql`
      INSERT INTO interview.session_observations
        (tenant_id, owner_user_id, session_id, source_id, event_id, sequence,
         kind, content, ack)
      VALUES (${scope.tenantId}::uuid, ${scope.actorId}::uuid, ${sessionId}::uuid,
        ${OWNER_MICROPHONE_SOURCE_ID}, ${requestId}, ${sequence}, 'transcript.final',
        ${JSON.stringify({
          occurredAt: new Date(row.nowMs).toISOString(),
          sourceSequence: sequence,
          body: {
            speaker: "microphone",
            text,
            startMs: atMs,
            endMs: atMs,
          },
        })}::jsonb,
        ${JSON.stringify(ack)}::jsonb)`);
    return ack;
  });
}

// Stores one owner input for the owner's open session. The session row lock
// serializes it with ingest, the processor's writes and the purge.
export async function storeOwnerInput(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  raw: unknown,
): Promise<OwnerInputAck> {
  assertUuid(sessionId);
  // Heard speech (ADR-0022) has its own, smaller request and its own row.
  const heard = liveHeardRequestSchema.safeParse(raw);
  if (heard.success) return storeHeard(database, scope, sessionId, heard.data);
  const parsed = liveOwnerInputRequestSchema.safeParse(raw);
  if (!parsed.success) throw new SessionError("invalid_input");
  const { requestId, ...body } = parsed.data;
  return inOwnerScope(database, scope, async (tx) => {
    const row = await lockSession(tx, scope, sessionId);
    assertAcceptsOwnerInput(row);

    // [SAFETY] Dedup on the request id: an identical resend returns the
    // original acknowledgement; the same id with different content is refused
    // and the stored original stays as it is.
    const stored = await findStoredOwnerInput(tx, scope, sessionId, requestId);
    if (stored) {
      const storedBody = (stored.content as { body?: unknown }).body;
      if (!sameBody(storedBody, body)) throw new SessionError("invalid_input");
      return { requestId, sequence: Number(stored.sequence) };
    }

    // [SAFETY] Exact snapshot ids, validated against THIS session's own
    // screen snapshots (with a stored image): an unknown, foreign or
    // non-snapshot id is one refusal that discloses nothing.
    if (body.snapshots.length > 0) {
      const found = await rowsOf<{ source_id: string; event_id: string }>(
        tx,
        sql`SELECT source_id, event_id FROM interview.session_observations
            WHERE tenant_id = ${scope.tenantId}::uuid
              AND owner_user_id = ${scope.actorId}::uuid
              AND session_id = ${sessionId}::uuid
              AND kind = 'screen.snapshot'
              AND screenshot_artifact_id IS NOT NULL
              AND (source_id, event_id) IN (${sql.join(
                body.snapshots.map(
                  (snapshot) =>
                    sql`(${snapshot.sourceId}, ${snapshot.eventId})`,
                ),
                sql`, `,
              )})`,
      );
      const distinct = new Set(
        body.snapshots.map((s) => `${s.sourceId}/${s.eventId}`),
      );
      if (
        found.length !== distinct.size ||
        distinct.size !== body.snapshots.length
      )
        throw new SessionError("invalid_input");
    }

    const sequence = await nextOwnerSequence(tx, scope, sessionId);
    return insertOwnerInput(
      tx,
      scope,
      sessionId,
      row,
      requestId,
      sequence,
      body,
    );
  });
}
