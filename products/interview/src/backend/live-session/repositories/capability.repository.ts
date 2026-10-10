// Persistence of the capture companion's latest self-reported readiness for
// its owner (capability.report, ADR-0012 Locality by stage). One row per
// (tenant, owner) under forced row security binding tenant AND actor: the
// actor is the session owner on the ingest write and the signed-in member on
// the browser read, so another member of the same workspace never reads or
// replaces it. The row is device capability, never content: states and a
// language tag only. Nothing here logs.
import type {
  CapabilityReport,
  CompanionDeclaration,
} from "@omnitech/active-session-contracts";
import type { TenantDatabase } from "@omnitech/database";
import { and, eq, or, sql } from "drizzle-orm";
import { companionCapabilities } from "../../db/live-session";
import type { OwnerScope } from "../scope";

const c = companionCapabilities;
const ownedBy = (scope: OwnerScope) =>
  and(eq(c.tenantId, scope.tenantId), eq(c.ownerUserId, scope.actorId));

// True when the owner's last report is newer than `minIntervalMs` (database
// clock), so a report loop cannot hammer the row.
export async function reportedWithin(
  tx: TenantDatabase,
  scope: OwnerScope,
  minIntervalMs: number,
): Promise<boolean> {
  const rows = await tx
    .select({
      recent: sql<boolean>`(${c.reportedAt} > now() - (${minIntervalMs}::int * interval '1 millisecond'))`,
    })
    .from(c)
    .where(ownedBy(scope));
  return rows[0]?.recent === true;
}

// Records what the companion declared on its request (ADR-0020), only when it
// differs from the stored row, so a heartbeat loop writes nothing. No row yet
// (no report): nothing to update; the first report stores the declaration.
export async function noteDeclaration(
  tx: TenantDatabase,
  scope: OwnerScope,
  declaration: CompanionDeclaration,
): Promise<void> {
  const selection = declaration.screenSelection ?? null;
  await tx
    .update(c)
    .set({
      captureRequestSupport: declaration.captureRequests,
      screenSelection: selection,
    })
    .where(
      and(
        ownedBy(scope),
        or(
          sql`${c.captureRequestSupport} IS DISTINCT FROM ${declaration.captureRequests}`,
          sql`${c.screenSelection} IS DISTINCT FROM ${selection}`,
        ),
      ),
    );
}

// What the owner's companion last declared, or null before its first report.
export async function readDeclaration(
  tx: TenantDatabase,
  scope: OwnerScope,
): Promise<CompanionDeclaration | null> {
  const rows = await tx
    .select({
      captureRequestSupport: c.captureRequestSupport,
      screenSelection: c.screenSelection,
    })
    .from(c)
    .where(ownedBy(scope));
  const row = rows[0];
  if (!row) return null;
  return {
    captureRequests: row.captureRequestSupport,
    ...(row.screenSelection ? { screenSelection: row.screenSelection } : {}),
  };
}

// Replaces the owner's row with this report (the latest report wins).
export async function storeCapability(
  tx: TenantDatabase,
  scope: OwnerScope,
  report: CapabilityReport,
  declaration: CompanionDeclaration,
): Promise<void> {
  const reported = {
    reportedAt: sql`now()`,
    speechLocale: report.speech.locale,
    speechOnDeviceAvailable: report.speech.onDeviceAvailable,
    speechRecognizerAvailable: report.speech.recognizerAvailable,
    speechAuthorizationStatus: report.speech.authorizationStatus,
    microphone: report.permissions.microphone,
    screen: report.permissions.screen,
    captureRequestSupport: declaration.captureRequests,
    screenSelection: declaration.screenSelection ?? null,
  };
  await tx
    .insert(c)
    .values({
      tenantId: scope.tenantId,
      ownerUserId: scope.actorId,
      ...reported,
    })
    .onConflictDoUpdate({
      target: [c.tenantId, c.ownerUserId],
      set: reported,
    });
}

export type CapabilityRow = typeof companionCapabilities.$inferSelect;

// The owner's stored row, or undefined before the first report.
export async function readCapability(
  tx: TenantDatabase,
  scope: OwnerScope,
): Promise<CapabilityRow | undefined> {
  const rows = await tx.select().from(c).where(ownedBy(scope));
  return rows[0];
}
