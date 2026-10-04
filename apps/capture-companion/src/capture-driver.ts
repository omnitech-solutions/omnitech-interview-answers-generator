// The platform's capture, behind the smallest possible port: start and stop
// named sources, and capture ONCE on request. Stopping is synchronous and
// needs no network, which is what lets a local stop work while Studio is down.
import type {
  CaptureFailureCode,
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
  | {
      kind: "lost";
      // The closed failure code the companion reports to Studio, correlated to
      // the request, so the owner hears at once instead of at expiry.
      code: Extract<
        CaptureFailureCode,
        "no-focused-window" | "permission-denied" | "capture-failed"
      >;
    };

// What the platform reports about the focused window at the moment it is
// sampled. Opaque to the companion: it is taken when the request is taken from
// an acknowledgement and handed back to captureOnce, so the capture is of the
// window that held focus then, never of whatever holds it after the press that
// made the request (ADR-0020).
export type FocusSample = unknown;

export type CaptureDriver = {
  start(source: CaptureSource): void;
  stop(source: CaptureSource): void;
  stopAll(): void;
  // The driver's token for the screen source now selected (display identity
  // plus a generation that changes whenever the selection restarts). Sent on
  // every request so Studio can bind a mask to it; undefined while no screen
  // source is selected.
  screenSelection(): string | undefined;
  // Samples the focused window now (see FocusSample).
  sampleFocus(): FocusSample;
  // One capture for a request Studio handed over, of the sampled focus. Called
  // only while the screen source the user selected at start is running.
  captureOnce(
    request: CaptureRequest,
    focus: FocusSample,
  ): Promise<CaptureOnceResult>;
};
