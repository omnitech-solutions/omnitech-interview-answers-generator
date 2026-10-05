// Whether the panel's glass is clear (see-through) or the default tinted glass:
// a per-viewer choice kept in this browser, shared by every panel window of the
// app through the `storage` event, as the Auto preference is. The one effect is
// the `data-glass` attribute on the panel root; panels.css flips the glass tokens
// from it. localStorage is optional: every access is guarded, and the choice is
// then kept in memory for this window only.
import { useCallback, useEffect, useState } from "react";

export const GLASS_STORAGE_KEY = "interview-studio.panel.glass.v1";
export const GLASS_ATTRIBUTE = "data-glass";
export const GLASS_CLEAR = "clear";

// null: nothing readable stored (or no storage), so the caller keeps what it has.
export function loadGlassClear(): boolean | null {
  try {
    const stored = window.localStorage.getItem(GLASS_STORAGE_KEY);
    if (stored === "clear") return true;
    if (stored === "tinted") return false;
  } catch {
    // Storage is blocked: the in-memory value stands.
  }
  return null;
}

function saveGlassClear(clear: boolean): void {
  try {
    window.localStorage.setItem(GLASS_STORAGE_KEY, clear ? "clear" : "tinted");
  } catch {
    // Kept for this window only.
  }
}

export type PanelGlass = { clear: boolean; toggle(): void };

// The attribute for the panel root: only present while clear, so the default
// look has no attribute at all.
export const glassAttributes = (
  glass: PanelGlass,
): { "data-glass"?: typeof GLASS_CLEAR } =>
  glass.clear ? { [GLASS_ATTRIBUTE]: GLASS_CLEAR } : {};

export function usePanelGlass(): PanelGlass {
  // Read in the first render, so the first paint already has the right look.
  const [clear, setClear] = useState(() => loadGlassClear() ?? false);
  useEffect(() => {
    const onStorage = () => {
      const stored = loadGlassClear();
      if (stored !== null) setClear(stored);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const toggle = useCallback(
    () =>
      setClear((now) => {
        saveGlassClear(!now);
        return !now;
      }),
    [],
  );
  return { clear, toggle };
}
