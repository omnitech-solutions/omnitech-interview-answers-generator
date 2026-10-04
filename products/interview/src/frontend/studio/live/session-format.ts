// Small labels the live view shares. Pure.
import type { CompanionModel } from "./session-sources";

// How long ago, by the minute: a label that changed every second would be read
// out again and again by a screen reader (the banners are live regions).
export function ageLabel(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// "3:07": how far into the session a line arrived, from the server's own
// timestamps, so the same line reads the same on every clock and in every zone.
export function clockLabel(receivedAt: string, sessionStart: string): string {
  const at = Date.parse(receivedAt);
  const start = Date.parse(sessionStart);
  if (Number.isNaN(at) || Number.isNaN(start)) return "";
  const seconds = Math.max(0, Math.floor((at - start) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

// Server time as ms, or null when the timestamp is missing or unreadable.
export function sinceMs(
  iso: string | null | undefined,
  serverNowMs: number,
): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : Math.max(0, serverNowMs - at);
}

// What the server's record says about the companion, in one place for the
// pairing chip and the Sources row. "In contact" only on a recorded heartbeat
// (never from a source's history): never-seen is never connected.
export function companionContact(
  companion: CompanionModel,
  // The selected inputs that only the companion can supply (microphone,
  // application audio). Empty: the companion is optional for this session.
  dependsOn: readonly string[] = [],
): {
  tone: "neutral" | "green" | "red";
  text: string;
} {
  if (companion.status === "never-seen")
    // Optional and unused is not an alarm; a selected companion input that has
    // never connected is.
    return dependsOn.length === 0
      ? { tone: "neutral", text: "No contact yet" }
      : { tone: "red", text: "Capture companion hasn’t made contact" };
  const age = ageLabel(companion.ageMs ?? 0);
  return companion.status === "online"
    ? { tone: "green", text: `In contact · last heard ${age} ago` }
    : {
        tone: "red",
        text: `Capture companion went offline. No contact for ${age}`,
      };
}

// What an absent companion affects, in terms of the selected inputs only: the
// session's own state and Studio's activity are said elsewhere and are not
// changed by it. null while the companion is in contact or nothing depends on it.
export function companionImpact(
  companion: CompanionModel,
  dependsOn: readonly string[],
): string | null {
  if (companion.status === "online" || dependsOn.length === 0) return null;
  return `Affected inputs: ${dependsOn.join(", ")}. Nothing arrives from them until the companion is heard from again; the session itself and Studio keep running.`;
}
