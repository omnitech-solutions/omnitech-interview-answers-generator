// The capture companion's latest self-reported readiness for its owner
// (capability.report, ADR-0012 Locality by stage). One row per (tenant, owner)
// under forced row security binding tenant AND actor: the actor is the session
// owner on the ingest write and the signed-in member on the browser read, so
// another member of the same workspace never reads or replaces it. The row is
// device capability, never content: states and a language tag only. Nothing
// here logs.
import type { CapabilityReport } from "@omnitech/active-session-contracts";
import type { PlatformDatabase, TenantDatabase } from "@omnitech/database";
import type { LiveCompanionCapability } from "@omnitech/interview-contracts";
import { sql } from "drizzle-orm";
import { firstRow, inOwnerScope, type OwnerScope } from "./scope.js";

// True when the owner's last report is newer than `minIntervalMs` (database
// clock), so a report loop cannot hammer the row.
export async function reportedWithin(
  tx: TenantDatabase,
  scope: OwnerScope,
  minIntervalMs: number,
): Promise<boolean> {
  const row = await firstRow<{ recent: boolean }>(
    tx,
    sql`SELECT (reported_at > now() - (${minIntervalMs}::int * interval '1 millisecond')) AS recent
        FROM interview.companion_capabilities
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND owner_user_id = ${scope.actorId}::uuid`,
  );
  return row?.recent === true;
}

// Replaces the owner's row with this report (the latest report wins).
export async function storeCapability(
  tx: TenantDatabase,
  scope: OwnerScope,
  report: CapabilityReport,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO interview.companion_capabilities
      (tenant_id, owner_user_id, reported_at, speech_locale,
       speech_on_device_available, speech_recognizer_available,
       speech_authorization_status, microphone, screen)
    VALUES (${scope.tenantId}::uuid, ${scope.actorId}::uuid, now(),
      ${report.speech.locale}, ${report.speech.onDeviceAvailable},
      ${report.speech.recognizerAvailable},
      ${report.speech.authorizationStatus}, ${report.permissions.microphone},
      ${report.permissions.screen})
    ON CONFLICT (tenant_id, owner_user_id) DO UPDATE SET
      reported_at = now(),
      speech_locale = EXCLUDED.speech_locale,
      speech_on_device_available = EXCLUDED.speech_on_device_available,
      speech_recognizer_available = EXCLUDED.speech_recognizer_available,
      speech_authorization_status = EXCLUDED.speech_authorization_status,
      microphone = EXCLUDED.microphone,
      screen = EXCLUDED.screen`);
}

type Row = {
  reported_at: Date | string;
  speech_locale: string;
  speech_on_device_available: boolean;
  speech_recognizer_available: boolean;
  speech_authorization_status: LiveCompanionCapability["speech"]["authorizationStatus"];
  microphone: LiveCompanionCapability["permissions"]["microphone"];
  screen: LiveCompanionCapability["permissions"]["screen"];
};

// The signed-in member's own latest report, or null before the first one.
export async function getCompanionCapability(
  database: PlatformDatabase,
  scope: OwnerScope,
): Promise<LiveCompanionCapability | null> {
  const row = await inOwnerScope(database, scope, (tx) =>
    firstRow<Row>(
      tx,
      sql`SELECT reported_at, speech_locale, speech_on_device_available,
                 speech_recognizer_available, speech_authorization_status,
                 microphone, screen
          FROM interview.companion_capabilities
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid`,
    ),
  );
  if (!row) return null;
  return {
    reportedAt: new Date(row.reported_at).toISOString(),
    speech: {
      locale: row.speech_locale,
      onDeviceAvailable: row.speech_on_device_available,
      recognizerAvailable: row.speech_recognizer_available,
      authorizationStatus: row.speech_authorization_status,
    },
    permissions: { microphone: row.microphone, screen: row.screen },
  };
}
