// Where "Start hands-free" processes, as the owner last chose it, remembered
// per tenant in this browser. Nothing is preselected until the owner has chosen
// once (ADR-0012: locality is the owner's decision and can only be tightened
// after start, so it is never guessed). localStorage is optional and guarded.
import type { LiveProcessingPolicy } from "@omnitech/interview-contracts";

const key = (tenant: string) =>
  `interview-studio.live.hands-free-policy.${tenant}`;

export function loadHandsFreeChoice(
  tenant: string,
): LiveProcessingPolicy | null {
  try {
    const stored = window.localStorage.getItem(key(tenant));
    return stored === "device-only" || stored === "permitted-remote"
      ? stored
      : null;
  } catch {
    return null;
  }
}

export function saveHandsFreeChoice(
  tenant: string,
  policy: LiveProcessingPolicy,
): void {
  try {
    window.localStorage.setItem(key(tenant), policy);
  } catch {
    // Kept for this page only.
  }
}
