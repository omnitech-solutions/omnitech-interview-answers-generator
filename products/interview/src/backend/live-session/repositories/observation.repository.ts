// Persistence of a session's observations: the stored row a resend is compared
// with, the running counts the bounds are checked against, and the insert.
import type { Acknowledgement } from "@omnitech/active-session-contracts";
import type { TenantDatabase } from "@omnitech/database";
import { artifacts } from "@omnitech/platform-storage/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  OWNER_CAPTURE_SOURCE_ID,
  OWNER_MICROPHONE_SOURCE_ID,
  sessionObservations,
} from "../../db/live-session";
import type { OwnerScope } from "../scope";

const inSession = (scope: OwnerScope, sessionId: string) =>
  and(
    eq(sessionObservations.tenantId, scope.tenantId),
    eq(sessionObservations.ownerUserId, scope.actorId),
    eq(sessionObservations.sessionId, sessionId),
  );

export type StoredObservation = {
  sequence: number;
  ack: unknown;
  kind: string;
  content: unknown;
  // The digest of its screenshot's bytes, when it has one.
  payloadSha256: string | null;
};

// The observation already stored under this source and event id, if any.
export async function findStoredObservation(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  key: { sourceId: string; eventId: string },
): Promise<StoredObservation | undefined> {
  const rows = await tx
    .select({
      sequence: sessionObservations.sequence,
      ack: sessionObservations.ack,
      kind: sessionObservations.kind,
      content: sessionObservations.content,
      payloadSha256: sql<string | null>`${artifacts.metadata}->>'sha256'`,
    })
    .from(sessionObservations)
    .leftJoin(
      artifacts,
      and(
        eq(artifacts.tenantId, sessionObservations.tenantId),
        eq(artifacts.id, sessionObservations.screenshotArtifactId),
      ),
    )
    .where(
      and(
        inSession(scope, sessionId),
        eq(sessionObservations.sourceId, key.sourceId),
        eq(sessionObservations.eventId, key.eventId),
      ),
    );
  return rows[0];
}

export type ObservationCounts = {
  // Companion observations stored, ever and in the last minute.
  total: number;
  recent: number;
  screenshots: number;
  // Over every row: owner inputs take a sequence number too.
  maxSequence: number;
};

// The session's running counts. Owner inputs are the owner's own requests,
// stored DB-side: they count toward neither the capture cap nor the capture
// rate, and the owner's own browser captures and heard speech are exempt too.
// PostgreSQL's FILTER keeps it one pass over the session's rows.
export async function countObservations(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<ObservationCounts> {
  const o = sessionObservations;
  const companion = sql`${o.kind} <> 'owner.input' AND ${o.sourceId} NOT IN (${OWNER_CAPTURE_SOURCE_ID}, ${OWNER_MICROPHONE_SOURCE_ID})`;
  const rows = await tx
    .select({
      total: sql<number>`(count(*) FILTER (WHERE ${companion}))::int`,
      screenshots: sql<number>`(count(*) FILTER (WHERE ${o.kind} = 'screen.snapshot' AND ${o.sourceId} <> ${OWNER_CAPTURE_SOURCE_ID}))::int`,
      recent: sql<number>`(count(*) FILTER (WHERE ${companion} AND ${o.receivedAt} > now() - interval '1 minute'))::int`,
      maxSequence: sql<string | number>`COALESCE(max(${o.sequence}), 0)`,
    })
    .from(o)
    .where(inSession(scope, sessionId));
  const row = rows[0];
  return {
    total: row?.total ?? 0,
    screenshots: row?.screenshots ?? 0,
    recent: row?.recent ?? 0,
    maxSequence: Number(row?.maxSequence ?? 0),
  };
}

// How many owner inputs the session holds (their own cap).
export async function countOwnerInputs(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(sessionObservations)
    .where(
      and(
        inSession(scope, sessionId),
        eq(sessionObservations.kind, "owner.input"),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

export async function insertObservation(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  observation: {
    sourceId: string;
    eventId: string;
    sequence: number;
    kind: string;
    content: unknown;
    ack: Acknowledgement;
    screenshotArtifactId: string | null;
  },
): Promise<void> {
  await tx.insert(sessionObservations).values({
    tenantId: scope.tenantId,
    ownerUserId: scope.actorId,
    sessionId,
    sourceId: observation.sourceId,
    eventId: observation.eventId,
    sequence: observation.sequence,
    kind: observation.kind,
    content: observation.content,
    ack: observation.ack,
    screenshotArtifactId: observation.screenshotArtifactId,
  });
}
