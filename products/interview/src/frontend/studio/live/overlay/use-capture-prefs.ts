// The region and the hints, per tenant, kept in React state and mirrored to
// localStorage.
import { useCallback, useEffect, useState } from "react";
import {
  type CaptureSettings,
  loadDisplayMask,
  loadMask,
  loadSettings,
  saveDisplayMask,
  saveMask,
  saveSettings,
} from "./capture-prefs";
import type { Rect } from "./mask-geometry";

export function useCapturePrefs(tenant: string) {
  const [mask, setMaskState] = useState<Rect>(() => loadMask(tenant));
  const [displayMask, setDisplayMaskState] = useState<Rect>(() =>
    loadDisplayMask(tenant),
  );
  const [settings, setSettingsState] = useState<CaptureSettings>(() =>
    loadSettings(tenant),
  );
  // Another tenant has its own choices.
  useEffect(() => {
    setMaskState(loadMask(tenant));
    setDisplayMaskState(loadDisplayMask(tenant));
    setSettingsState(loadSettings(tenant));
  }, [tenant]);
  const setMask = useCallback(
    (next: Rect) => {
      saveMask(tenant, next);
      setMaskState(next);
    },
    [tenant],
  );
  const setDisplayMask = useCallback(
    (next: Rect) => {
      saveDisplayMask(tenant, next);
      setDisplayMaskState(next);
    },
    [tenant],
  );
  const setSettings = useCallback(
    (next: CaptureSettings) => {
      saveSettings(tenant, next);
      setSettingsState(next);
    },
    [tenant],
  );
  return { mask, setMask, displayMask, setDisplayMask, settings, setSettings };
}
