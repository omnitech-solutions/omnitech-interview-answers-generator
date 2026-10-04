// "This Mac (native)": the host adapter's screen as a share source (ADR-0019).
// It has the shape of the browser's ShareHandle so the strip, the mask chip and
// Analyze work unchanged; it differs in having no live stream (the host captures
// one fresh image per press) and in taking its own frames. Nothing is kept.
import { captureThroughHost } from "../host-adapter";
import {
  type Frame,
  FrameError,
  frameLabel,
  type ShareHandle,
} from "./capture-source";
import type { Rect } from "./mask-geometry";

export type NativeShareHandle = ShareHandle & {
  grab(mask: Rect): Promise<Frame>;
};

// [SAFETY] The label names the kind of source and whether a region applied,
// never a window title or application name.
export function startNativeShare(): NativeShareHandle {
  const listeners = new Set<() => void>();
  let ended = false;
  return {
    stream: new MediaStream(),
    kind: "This Mac",
    video: document.createElement("video"),
    stop() {
      ended = true;
      for (const listener of [...listeners]) listener();
      listeners.clear();
    },
    onEnded(listener) {
      if (ended) {
        listener();
        return () => undefined;
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async grab(mask) {
      const frame = await captureThroughHost(mask);
      if (!frame.ok)
        throw new FrameError(
          frame.reason === "display-changed" ||
            frame.reason === "permission-denied" ||
            frame.reason === "no-focused-window"
            ? frame.reason
            : "not-ready",
        );
      return {
        blob: frame.blob,
        label: frameLabel("This Mac", frame.masked),
        // The host reports no size; Studio never reads one for a stored frame.
        width: 0,
        height: 0,
        masked: frame.masked,
      };
    },
  };
}

export const isNativeShare = (
  handle: ShareHandle | null,
): handle is NativeShareHandle =>
  handle !== null && typeof (handle as NativeShareHandle).grab === "function";
