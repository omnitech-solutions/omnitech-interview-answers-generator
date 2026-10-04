// The platform's capture, behind the smallest possible port: start and stop
// named sources, and capture ONCE on request. Stopping is synchronous and
// needs no network, which is what lets a local stop work while Studio is down.
import type {
  CaptureRequest,
  CaptureSource,
  ScreenSnapshot,
} from "@omnitech/active-session-contracts";

// What one capture-now request produced. A loss is visible and never widens:
// a focused-window request with no window to capture is "no-focused-window",
// never the whole display. Codes only, no content.
export type CaptureOnceResult =
  | {
      kind: "image";
      payload: Uint8Array;
      mediaType: ScreenSnapshot["content"]["mediaType"];
      // The owning application's name only, never a window title.
      windowLabel: string;
    }
  | { kind: "lost"; code: "no-focused-window" | "capture-failed" };

export type CaptureDriver = {
  start(source: CaptureSource): void;
  stop(source: CaptureSource): void;
  stopAll(): void;
  // One capture for a request Studio handed over. Called only while the
  // screen source the user selected at start is running.
  captureOnce(request: CaptureRequest): Promise<CaptureOnceResult>;
};
