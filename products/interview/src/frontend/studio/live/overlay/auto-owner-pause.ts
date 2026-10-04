// A pause the OWNER pressed, remembered per session in this browser so every
// window of Studio (the tab's card, the overlay window, the PiP) agrees: Auto
// resumes a session that stopped for any other reason, never one the owner
// deliberately paused. localStorage is optional and every access is guarded.
const key = (sessionId: string) =>
  `interview-studio.live.owner-paused.${sessionId}`;

export function markOwnerPaused(sessionId: string): void {
  try {
    window.localStorage.setItem(key(sessionId), String(Date.now()));
  } catch {
    // Kept for this page only: Auto then reads the session as not owner-paused
    // in another window, which is the cost of having no storage.
    memory.add(sessionId);
  }
}
export function clearOwnerPaused(sessionId: string): void {
  memory.delete(sessionId);
  try {
    window.localStorage.removeItem(key(sessionId));
  } catch {
    // Nothing stored to clear.
  }
}
export function isOwnerPaused(sessionId: string): boolean {
  if (memory.has(sessionId)) return true;
  try {
    return window.localStorage.getItem(key(sessionId)) !== null;
  } catch {
    return false;
  }
}
const memory = new Set<string>();
