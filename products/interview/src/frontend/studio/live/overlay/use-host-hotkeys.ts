// Runs `onAnalyze` when the host's system-wide "capture-analyze" key is pressed.
// A host that offers no hotkeys, or no host at all, leaves this inert.
import { useEffect, useRef } from "react";
import { onHostHotkey } from "../host-adapter";
import { claimCaptureTrigger } from "./capture-trigger";

export function useHostHotkeys(onAnalyze: () => void): void {
  const latest = useRef(onAnalyze);
  latest.current = onAnalyze;
  useEffect(
    () =>
      onHostHotkey((hotkey) => {
        // A hidden page never captures; a visible one asks for the one grant
        // the other routes (key press, other windows) compete for.
        if (hotkey !== "capture-analyze") return;
        if (typeof document !== "undefined" && document.hidden) return;
        void claimCaptureTrigger().then((granted) => {
          if (granted) latest.current();
        });
      }),
    [],
  );
}
