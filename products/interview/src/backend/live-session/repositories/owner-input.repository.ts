// Persistence of the owner's own requests: the stored owner.input row a resend
// is compared with, the per-session counts the caps read, the standing of a
// task's actions, and the owner-capture count. No decision is made here.
import type { TenantDatabase } from "@omnitech/database";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  OWNER_CAPTURE_SOURCE_ID,
  OWNER_INPUT_SOURCE_ID,
  OWNER_MICROPHONE_SOURCE_ID,
  sessionActions,
  sessionObservations,
} from "../../db/live-session";
import type { OwnerScope } from "../scope";

const o = sessionObservations;

const inSession = (scope: OwnerScope, sessionId: string) =>
  and(
    eq(o.tenantId, scope.tenantId),
    eq(o.ownerUserId, scope.actorId),
    eq(o.sessionId, sessionId),
  );

// The stored row under one source and event id, if any.
async function findStoredBySource(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  sourceId: string,
  eventId: string,
): Promise<{ sequence: number; content: unknown } | undefined> {
  const rows = await tx
    .select({ sequence: o.sequence, content: o.content })
    .from(o)
    .where(
      and(
        inSession(scope, sessionId),
        eq(o.sourceId, sourceId),
        eq(o.eventId, eventId),
      ),
    );
  return rows[0];
}

// The stored owner input for a request id, if any.
export const findStoredOwnerInputRow = (
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  requestId: string,
) => findStoredBySource(tx, scope, sessionId, OWNER_INPUT_SOURCE_ID, requestId);

// The stored heard phrase (owner microphone source) for a request id, if any.
export const findStoredHeardRow = (
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  requestId: string,
) =>
  findStoredBySource(
    tx,
    scope,
    sessionId,
    OWNER_MICROPHONE_SOURCE_ID,
    requestId,
  );

// The owner inputs the session holds and its highest sequence, in one pass.
export async function readOwnerInputCounts(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<{ inputs: number; maxSequence: number }> {
  const rows = await tx
    .select({
      inputs: sql<number>`(count(*) FILTER (WHERE ${o.kind} = 'owner.input'))::int`,
      maxSequence: sql<string | number>`COALESCE(max(${o.sequence}), 0)`,
    })
    .from(o)
    .where(inSession(scope, sessionId));
  return {
    inputs: Number(rows[0]?.inputs ?? 0),
    maxSequence: Number(rows[0]?.maxSequence ?? 0),
  };
}

// The heard phrases the session holds and its highest sequence, in one pass.
export async function readHeardCounts(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<{ heard: number; maxSequence: number }> {
  const rows = await tx
    .select({
      heard: sql<number>`(count(*) FILTER (WHERE ${o.sourceId} = ${OWNER_MICROPHONE_SOURCE_ID}))::int`,
      maxSequence: sql<string | number>`COALESCE(max(${o.sequence}), 0)`,
    })
    .from(o)
    .where(inSession(scope, sessionId));
  return {
    heard: Number(rows[0]?.heard ?? 0),
    maxSequence: Number(rows[0]?.maxSequence ?? 0),
  };
}

// How many owner-capture observations the session holds.
export async function countOwnerCaptures(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(o)
    .where(
      and(inSession(scope, sessionId), eq(o.sourceId, OWNER_CAPTURE_SOURCE_ID)),
    );
  return Number(rows[0]?.n ?? 0);
}

// How many of the (source, event) pairs are screen snapshots of this session
// with a stored image.
export async function countSnapshotsWithImage(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  refs: readonly { sourceId: string; eventId: string }[],
): Promise<number> {
  const rows = await tx
    .select({ sourceId: o.sourceId, eventId: o.eventId })
    .from(o)
    .where(
      and(
        inSession(scope, sessionId),
        eq(o.kind, "screen.snapshot"),
        isNotNull(o.screenshotArtifactId),
        sql`(${o.sourceId}, ${o.eventId}) IN (${sql.join(
          refs.map((ref) => sql`(${ref.sourceId}, ${ref.eventId})`),
          sql`, `,
        )})`,
      ),
    );
  return rows.length;
}

// Inserts one observation row (content and ack are stored as given).
export async function insertOwnerObservation(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  row: {
    sourceId: string;
    eventId: string;
    sequence: number;
    kind: string;
    content: unknown;
    ack: unknown;
    screenshotArtifactId?: string;
  },
): Promise<void> {
  await tx.insert(o).values({
    tenantId: scope.tenantId,
    ownerUserId: scope.actorId,
    sessionId,
    sourceId: row.sourceId,
    eventId: row.eventId,
    sequence: row.sequence,
    kind: row.kind,
    content: row.content,
    ack: row.ack,
    ...(row.screenshotArtifactId === undefined
      ? {}
      : { screenshotArtifactId: row.screenshotArtifactId }),
  });
}

// The newest revision the task has an action row for, or null when it has none.
export async function readNewestTaskRevision(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  taskId: string,
): Promise<number | null> {
  const a = sessionActions;
  const rows = await tx
    .select({ newest: sql<number | null>`max(${a.taskRevision})::int` })
    .from(a)
    .where(
      and(
        eq(a.tenantId, scope.tenantId),
        eq(a.ownerUserId, scope.actorId),
        eq(a.sessionId, sessionId),
        eq(a.taskId, taskId),
      ),
    );
  return rows[0]?.newest ?? null;
}

// Whether any action of the task rests on a screen snapshot (its provenance
// ids carry the `snap/` prefix).
export async function taskRestsOnSnapshot(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  taskId: string,
): Promise<boolean> {
  const a = sessionActions;
  const rows = await tx
    .select({ found: sql<number>`1` })
    .from(a)
    .where(
      and(
        eq(a.tenantId, scope.tenantId),
        eq(a.ownerUserId, scope.actorId),
        eq(a.sessionId, sessionId),
        eq(a.taskId, taskId),
        sql`EXISTS (SELECT 1 FROM unnest(${a.sourceEventIds}) AS s(id)
                    WHERE s.id LIKE 'snap/%')`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// The stored snapshot's image digest and content, for the resend comparison.
export async function readSnapshotForResend(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  ref: { sourceId: string; eventId: string },
): Promise<{ sha256: string | null; content: unknown } | undefined> {
  // Raw: a LEFT JOIN with a jsonb operator, moved verbatim.
  const result = await tx.execute(
    sql`SELECT a.metadata->>'sha256' AS sha256, o.content
        FROM interview.session_observations o
        LEFT JOIN platform.artifacts a
          ON a.tenant_id = o.tenant_id AND a.id = o.screenshot_artifact_id
        WHERE o.tenant_id = ${scope.tenantId}::uuid
          AND o.owner_user_id = ${scope.actorId}::uuid
          AND o.session_id = ${sessionId}::uuid
          AND o.source_id = ${ref.sourceId}
          AND o.event_id = ${ref.eventId}`,
  );
  return (
    result.rows as unknown as { sha256: string | null; content: unknown }[]
  )[0];
}
