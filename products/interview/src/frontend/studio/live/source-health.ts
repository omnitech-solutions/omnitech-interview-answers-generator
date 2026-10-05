// How a capture source's health is NAMED and TONED, once. The session bar's
// chips, the Sources tab and the native source popover all read this table, so
// one health never reads "Stopped" on one surface and "Disconnected" on
// another. Pure; the health itself is derived in session-sources.ts.
import type { SourceHealth, SourceStatus } from "./session-sources";

export type HealthTone = "green" | "amber" | "red" | "neutral";

export const SOURCE_HEALTH: Record<
  SourceHealth,
  { label: string; tone: HealthTone }
> = {
  receiving: { label: "Receiving", tone: "green" },
  waiting: { label: "Not receiving", tone: "neutral" },
  disconnected: { label: "Disconnected", tone: "red" },
  "lost-permission": { label: "Permission revoked", tone: "amber" },
  lost: { label: "Capture lost", tone: "red" },
  gap: { label: "Audio dropped", tone: "amber" },
  "not-selected": { label: "Not selected", tone: "neutral" },
};

const NO_RECENT_CONTACT = {
  label: "No recent contact",
  tone: "neutral",
} as const;

// "Receiving" was derived from earlier observations; it is only said while the
// companion is in contact, never from history alone.
export function shownHealth(
  status: Pick<SourceStatus, "health">,
  companionOnline: boolean,
): { label: string; tone: HealthTone } {
  return status.health === "receiving" && !companionOnline
    ? NO_RECENT_CONTACT
    : SOURCE_HEALTH[status.health];
}
