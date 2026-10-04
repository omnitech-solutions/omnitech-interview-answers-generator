// How the one window captures the screen: "auto" analyses a new screen by itself
// (while the analysis is showing and a browser is in front); "manual" only when
// the person presses capture. Kept per tenant in this browser; auto until chosen.
import { useCallback, useState } from "react";
import {
  type CaptureMode,
  DEFAULT_CAPTURE_MODE,
  isCaptureMode,
} from "./toolbar-config";

export type { CaptureMode };

const key = (tenant: string) =>
  `interview-studio.panels.capture-mode.${tenant}`;

export function loadCaptureMode(tenant: string): CaptureMode {
  try {
    const stored = window.localStorage.getItem(key(tenant));
    return isCaptureMode(stored) ? stored : DEFAULT_CAPTURE_MODE;
  } catch {
    return DEFAULT_CAPTURE_MODE;
  }
}

export function saveCaptureMode(tenant: string, mode: CaptureMode): void {
  try {
    window.localStorage.setItem(key(tenant), mode);
  } catch {
    // Kept for this page only.
  }
}

export function useCaptureMode(
  tenant: string,
): [CaptureMode, (mode: CaptureMode) => void] {
  const [mode, setMode] = useState<CaptureMode>(() => loadCaptureMode(tenant));
  const choose = useCallback(
    (next: CaptureMode) => {
      saveCaptureMode(tenant, next);
      setMode(next);
    },
    [tenant],
  );
  return [mode, choose];
}
