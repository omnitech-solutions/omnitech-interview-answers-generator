import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "../live/shared/copy-text";

// A copy button's state: `copied` turns true only after the text really
// reached the clipboard, then clears itself; the timer dies with the component.
export function useCopied(resetMs = 1_500) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback(
    async (text: string) => {
      const written = await copyText(text);
      if (written) {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), resetMs);
      }
      return written;
    },
    [resetMs],
  );
  return { copied, copy };
}
