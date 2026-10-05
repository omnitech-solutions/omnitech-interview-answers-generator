// The one window's size mode (WINDOW_MODES): Normal, Mini player or Full screen.
// The page owns it and it always starts Normal; the shell is only told the
// size (setWindowSize) or full screen (setFullScreen) and reports nothing back.
// Leaving full screen always asks the shell to restore the frame first, so the
// next size change starts from the window the person had.
import type { PresentationHost } from "@omnitech/interview-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { WINDOW_MODES, type WindowModeId } from "./toolbar-config";

export type PanelWindowMode = {
  mode: WindowModeId;
  set(next: WindowModeId): void;
  // The green dot's click: Normal goes to Full screen; Full screen and Mini
  // player go back to Normal.
  toggleFullScreen(): void;
};

// Whether the host can do what a mode needs (Normal needs nothing).
export const modeAvailable = (
  host: PresentationHost,
  id: WindowModeId,
): boolean => {
  const needs = WINDOW_MODES.find((mode) => mode.id === id)?.needs ?? null;
  return needs === null || typeof host[needs] === "function";
};

export function usePanelWindowMode(host: PresentationHost): PanelWindowMode {
  const [mode, setMode] = useState<WindowModeId>("normal");
  // Read at call time, so two quick calls see each other.
  const now = useRef(mode);
  const set = useCallback(
    (next: WindowModeId) => {
      const was = now.current;
      if (next === was || !modeAvailable(host, next)) return;
      if (was === "full") void host.setFullScreen?.(false);
      if (next === "full") void host.setFullScreen?.(true);
      now.current = next;
      setMode(next);
    },
    [host],
  );
  const toggleFullScreen = useCallback(
    () => set(now.current === "normal" ? "full" : "normal"),
    [set],
  );
  // Escape leaves Full screen (D27 names no other mode). A menu or dialog that
  // took the key has already handled it, and typing in a field keeps it.
  useEffect(() => {
    if (mode !== "full") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.isComposing) return;
      if (isEditable(document.activeElement)) return;
      set("normal");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, set]);
  return { mode, set, toggleFullScreen };
}

// A field the person may be typing in: Escape there is not "leave full screen".
export function isEditable(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return (
    element.isContentEditable ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "INPUT" ||
    element.tagName === "SELECT"
  );
}
