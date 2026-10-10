// The signed-in member's own view of what their capture companion last
// reported (capability.report, ADR-0012 Locality by stage). The row and its
// row security are repositories/capability.repository.ts'; this is the read
// the browser makes. Device capability, never content. Nothing here logs.
import type { PlatformDatabase } from "@omnitech/database";
import type { LiveCompanionCapability } from "@omnitech/interview-contracts";
import { readCapability } from "./repositories/capability.repository";
import { inOwnerScope, type OwnerScope } from "./scope";

// The signed-in member's own latest report, or null before the first one.
export async function getCompanionCapability(
  database: PlatformDatabase,
  scope: OwnerScope,
): Promise<LiveCompanionCapability | null> {
  const row = await inOwnerScope(database, scope, (tx) =>
    readCapability(tx, scope),
  );
  if (!row) return null;
  return {
    reportedAt: new Date(row.reportedAt).toISOString(),
    speech: {
      locale: row.speechLocale,
      onDeviceAvailable: row.speechOnDeviceAvailable,
      recognizerAvailable: row.speechRecognizerAvailable,
      authorizationStatus:
        row.speechAuthorizationStatus as LiveCompanionCapability["speech"]["authorizationStatus"],
    },
    permissions: {
      microphone:
        row.microphone as LiveCompanionCapability["permissions"]["microphone"],
      screen: row.screen as LiveCompanionCapability["permissions"]["screen"],
    },
    captureRequests: row.captureRequestSupport,
    ...(row.screenSelection ? { screenSelection: row.screenSelection } : {}),
  };
}
