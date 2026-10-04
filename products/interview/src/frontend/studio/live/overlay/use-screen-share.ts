// The shared source for this card: started from a click, kept open until the
// person stops it (here or from the browser's own control) or the card goes
// away. The preview is the stream itself, shown locally and never uploaded.
import { useCallback, useEffect, useRef, useState } from "react";
import { nativeCaptureAvailable } from "../host-adapter";
import {
  type Frame,
  grabFrame,
  ShareError,
  type ShareHandle,
  type SourceKind,
  startShare,
} from "./capture-source";
import type { Rect } from "./mask-geometry";
import { isNativeShare, startNativeShare } from "./native-share";

export type ShareStatus = "idle" | "starting" | "sharing";

export const SHARE_MESSAGES = {
  unsupported:
    "This browser can’t share a window, tab or screen. Use Chrome or Edge, or the companion’s capture.",
  cancelled: "Nothing was shared.",
  failed: "Couldn’t start sharing. Try again.",
  ended: "Sharing stopped. Share a window, tab or screen to capture again.",
} as const;

export function useScreenShare() {
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [kind, setKind] = useState<SourceKind | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const handle = useRef<ShareHandle | null>(null);
  const removeEnded = useRef<(() => void) | null>(null);

  const release = useCallback(() => {
    removeEnded.current?.();
    removeEnded.current = null;
    handle.current = null;
    setStatus("idle");
    setKind(null);
    setStream(null);
  }, []);

  // Straight from a click handler: the browser requires the user gesture.
  const start = useCallback(async () => {
    if (handle.current) return true;
    setMessage(null);
    setStatus("starting");
    try {
      const started = nativeCaptureAvailable()
        ? startNativeShare()
        : await startShare();
      handle.current = started;
      removeEnded.current = started.onEnded(() => {
        release();
        setMessage(SHARE_MESSAGES.ended);
      });
      setKind(started.kind);
      setStream(started.stream);
      setStatus("sharing");
      return true;
    } catch (error) {
      setStatus("idle");
      const code = error instanceof ShareError ? error.code : "failed";
      setMessage(SHARE_MESSAGES[code]);
      return false;
    }
  }, [release]);

  const stop = useCallback(() => {
    const current = handle.current;
    if (!current) return;
    release();
    current.stop();
  }, [release]);

  const grab = useCallback((mask: Rect): Promise<Frame> => {
    const current = handle.current;
    if (!current) return Promise.reject(new ShareError("failed"));
    return isNativeShare(current)
      ? current.grab(mask)
      : grabFrame(current, mask);
  }, []);

  useEffect(
    () => () => {
      handle.current?.stop();
    },
    [],
  );

  return { status, kind, stream, message, start, stop, grab };
}
