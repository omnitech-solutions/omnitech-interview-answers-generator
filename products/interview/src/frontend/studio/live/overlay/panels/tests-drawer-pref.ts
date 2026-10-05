// Whether the code pane's Tests drawer is open: a per-viewer choice kept in this
// browser, shared by every panel window through the `storage` event, exactly as
// the glass preference is. Closed unless the person opened it. localStorage is
// optional: every access is guarded, and the choice is then kept in memory.
import { useCallback, useEffect, useState } from "react";

export const TESTS_DRAWER_STORAGE_KEY =
  "interview-studio.panel.tests-drawer.v1";

// null: nothing readable stored (or no storage), so the caller keeps what it has.
export function loadTestsDrawerOpen(): boolean | null {
  try {
    const stored = window.localStorage.getItem(TESTS_DRAWER_STORAGE_KEY);
    if (stored === "open") return true;
    if (stored === "closed") return false;
  } catch {
    // Storage is blocked: the in-memory value stands.
  }
  return null;
}

function saveTestsDrawerOpen(open: boolean): void {
  try {
    window.localStorage.setItem(
      TESTS_DRAWER_STORAGE_KEY,
      open ? "open" : "closed",
    );
  } catch {
    // Kept for this window only.
  }
}

export function useTestsDrawerOpen(): { open: boolean; toggle(): void } {
  // Read in the first render, so the first paint is already right.
  const [open, setOpen] = useState(() => loadTestsDrawerOpen() ?? false);
  useEffect(() => {
    const onStorage = () => {
      const stored = loadTestsDrawerOpen();
      if (stored !== null) setOpen(stored);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const toggle = useCallback(
    () =>
      setOpen((now) => {
        saveTestsDrawerOpen(!now);
        return !now;
      }),
    [],
  );
  return { open, toggle };
}
