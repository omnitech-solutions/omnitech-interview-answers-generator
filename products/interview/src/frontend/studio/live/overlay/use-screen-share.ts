// The shared source for this card: started from a click, kept open until the
// person stops it (here or from the browser's own control) or the card goes
// away. The preview is the stream itself, shown locally and never uploaded.

import type { StudioHostCaptureIntent } from "@omnitech/interview-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { captureThroughHost, nativeCaptureAvailable } from "../host-adapter";
import { holdAwake } from "../keep-awake";
import type { CaptureProblemReason } from "../shared/capture-problem";
import { type FrameHash, hashImage, sampleVideo } from "./auto-hash";
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
import { takeParkedShare } from "./share-handoff";

export type ShareStatus = "idle" | "starting" | "sharing";

// Why a share did not start or stopped, as a closed capture-problem reason (the
// one table in shared/capture-problem.ts says it in words).
const SHARE_PROBLEMS = {
  unsupported: "share-unsupported",
  cancelled: "share-cancelled",
  failed: "share-failed",
  ended: "source-lost",
} as const satisfies Record<string, CaptureProblemReason>;

// `ready` false holds the adoption of a parked share until a session is open
// (a host that mounts before the session starts).
export function useScreenShare(ready = true) {
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [kind, setKind] = useState<SourceKind | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [problem, setProblem] = useState<CaptureProblemReason | null>(null);
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

  const adopt = useCallback(
    (started: ShareHandle) => {
      handle.current = started;
      removeEnded.current = started.onEnded(() => {
        release();
        setProblem(SHARE_PROBLEMS.ended);
      });
      setKind(started.kind);
      setStream(started.stream);
      setStatus("sharing");
    },
    [release],
  );

  // A live share keeps the session store reading while this page is hidden.
  useEffect(() => {
    if (!stream) return;
    return holdAwake();
  }, [stream]);

  // A share asked for by "Start hands-free", in the click that started the
  // session, is taken over once the card is here.
  useEffect(() => {
    if (!ready) return;
    const parked = takeParkedShare();
    if (parked && !handle.current) adopt(parked);
    else parked?.stop();
  }, [adopt, ready]);

  // Straight from a click handler: the browser requires the user gesture.
  const start = useCallback(async () => {
    if (handle.current) return true;
    setProblem(null);
    setStatus("starting");
    try {
      const started = nativeCaptureAvailable()
        ? startNativeShare()
        : await startShare();
      adopt(started);
      return true;
    } catch (error) {
      setStatus("idle");
      const code = error instanceof ShareError ? error.code : "failed";
      setProblem(SHARE_PROBLEMS[code]);
      return false;
    }
  }, [release, adopt]);

  const stop = useCallback(() => {
    const current = handle.current;
    if (!current) return;
    release();
    current.stop();
  }, [release]);

  const grab = useCallback(
    (mask: Rect, intent: StudioHostCaptureIntent = "auto"): Promise<Frame> => {
      const current = handle.current;
      if (!current) return Promise.reject(new ShareError("failed"));
      return isNativeShare(current)
        ? current.grab(mask, intent)
        : grabFrame(current, mask);
    },
    [],
  );

  // A hash of the current frame inside the region, for Auto's interval: the
  // browser share's video, or (native host) one fresh host capture, hashed here
  // and dropped. A refused host capture throws its reason as `code`.
  const sample = useCallback(async (mask: Rect): Promise<FrameHash | null> => {
    const current = handle.current;
    if (current && !isNativeShare(current)) {
      try {
        return sampleVideo(current.video, mask);
      } catch {
        return null;
      }
    }
    if (!nativeCaptureAvailable()) return null;
    const frame = await captureThroughHost(mask);
    if (!frame.ok)
      throw Object.assign(new Error(frame.reason), {
        code: frame.reason,
        frontApp:
          frame.reason === "no-focused-window" ? frame.frontApp : undefined,
      });
    return hashImage(frame.blob);
  }, []);

  useEffect(
    () => () => {
      handle.current?.stop();
    },
    [],
  );

  return { status, kind, stream, problem, start, stop, grab, sample };
}
