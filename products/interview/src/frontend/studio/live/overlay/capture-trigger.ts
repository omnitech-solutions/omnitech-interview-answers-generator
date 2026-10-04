// One physical "capture & analyze" press is ONE logical capture. The same press
// can reach the card by several routes at once: its own Alt+Shift+A keydown, the
// native shell's system-wide hotkey (to every page it hosts: the Studio tab's
// card and the overlay window) and a key repeat. Each route asks here first; a
// trigger is granted once per window of time, in this page by a timestamp and
// across same-origin windows by a Web Lock that nobody else can take meanwhile.
// Without Web Locks, the page-level rule still holds.
export const TRIGGER_WINDOW_MS = 800;
const LOCK_NAME = "interview-studio.capture-trigger";

let lastGrantedAt = Number.NEGATIVE_INFINITY;

// Tests: forget the last grant.
export function resetCaptureTrigger(): void {
  lastGrantedAt = Number.NEGATIVE_INFINITY;
}

export async function claimCaptureTrigger(): Promise<boolean> {
  const now = Date.now();
  if (now - lastGrantedAt < TRIGGER_WINDOW_MS) return false;
  lastGrantedAt = now;
  const locks =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as { locks?: LockManager }).locks;
  if (!locks) return true;
  try {
    return await new Promise<boolean>((resolve) => {
      void locks
        .request(LOCK_NAME, { ifAvailable: true }, (lock) => {
          resolve(lock !== null);
          // Held for the window, so another window's press of the same key is
          // refused; released by itself.
          return lock
            ? new Promise<void>((release) =>
                setTimeout(release, TRIGGER_WINDOW_MS),
              )
            : undefined;
        })
        .catch(() => resolve(true));
    });
  } catch {
    return true;
  }
}
