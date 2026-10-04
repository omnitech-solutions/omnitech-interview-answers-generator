// Runs `onAnalyze` when the host's system-wide "capture-analyze" key is pressed.
// A host that offers no hotkeys, or no host at all, leaves this inert.
import { useEffect, useRef } from "react";
import { onHostHotkey } from "../host-adapter";

export function useHostHotkeys(onAnalyze: () => void): void {
  const latest = useRef(onAnalyze);
  latest.current = onAnalyze;
  useEffect(
    () =>
      onHostHotkey((hotkey) => {
        if (hotkey === "capture-analyze") latest.current();
      }),
    [],
  );
}
