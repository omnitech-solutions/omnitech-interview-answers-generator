// The staging tray's state machine (D29, D30): screenshots staged ON THE DEVICE
// until Apply, then ONE atomic request. Pure: no clock, no network, no React.
// The hook (use-screenshot-tray.ts) feeds it events; both surfaces draw the
// same state. Nothing here ever holds image text or logs anything.
import {
  LIVE_OWNER_INPUT_MAX_SNAPSHOTS,
  type LiveCaptureDisplay,
  type LiveScreenshotSend,
  type LiveScreenshotSent,
} from "@omnitech/interview-contracts";
import { SENT_AS_LABEL, sendsSentence } from "./screenshot-send";

// The server refuses a request with more images (reason `image_count`).
export const MAX_STAGED_IMAGES = LIVE_OWNER_INPUT_MAX_SNAPSHOTS;
// Apply waits this long for the on-device text of a still-unread image, then
// sends without it (the image is still sent).
export const OCR_WAIT_MS = 8_000;

export type StagedShot = {
  id: string;
  // The bytes that will be sent; a crop replaces them with a new Blob.
  blob: Blob;
  // The capture's own label ("Window", "This Mac · region"), never a title.
  label: string;
  display: LiveCaptureDisplay | null;
  // When it was staged (ms), for the time under its thumbnail.
  at: number;
};

// 'new': a NEW task from the images. 'add': a new revision of the task shown.
export type TrayIntent = "new" | "add";

// Why the last Apply (or Add) did not go through: the server's closed reasons,
// plus 'request' for anything else (retry with the same request id).
export const TRAY_FAILURES = [
  "stale_target",
  "vision_device_only",
  "image_count",
  "image_too_large",
  "image_dimensions",
  "image_type",
  "ocr",
  "request",
] as const;
export type TrayFailure = (typeof TRAY_FAILURES)[number];

export const TRAY_FAILURE_TEXT: Record<TrayFailure, string> = {
  stale_target: "This task has changed; re-select it.",
  vision_device_only:
    "Device-only mode never sends a screenshot to a model, so none can be applied.",
  image_count: `At most ${MAX_STAGED_IMAGES} screenshots can be applied at once.`,
  image_too_large: "A screenshot is over the 2 MB limit. Crop it or remove it.",
  image_dimensions: "A screenshot is too small or too large to send.",
  image_type: "Only JPEG, PNG or WebP screenshots can be sent.",
  ocr: "The text read from the screenshots was refused. Remove one and try again.",
  request: "That didn't go through. Nothing changed; try again.",
};

// What a failed command said, as a tray failure (unknown words are 'request').
export function trayFailureOf(result: {
  code: string;
  reason?: string | undefined;
}): TrayFailure {
  const reason = result.reason;
  return (TRAY_FAILURES as readonly string[]).includes(reason ?? "")
    ? (reason as TrayFailure)
    : "request";
}

export type TrayState = {
  items: readonly StagedShot[];
  intent: TrayIntent;
  // null: the default for the capture mode (Manual open, Auto closed).
  open: boolean | null;
  applying: boolean;
  // One per Apply, reused for a retry; cleared by any edit.
  requestId: string | null;
  failure: TrayFailure | null;
};

export const EMPTY_TRAY: TrayState = {
  items: [],
  intent: "add",
  open: null,
  applying: false,
  requestId: null,
  failure: null,
};

export type TrayEvent =
  | { type: "stage"; shot: StagedShot; intent?: TrayIntent }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; by: -1 | 1 }
  | { type: "crop"; id: string; blob: Blob }
  | { type: "intent"; intent: TrayIntent }
  | { type: "open"; open: boolean }
  | { type: "discard" }
  // The session changed: an empty tray, even mid-Apply.
  | { type: "reset" }
  | { type: "apply"; requestId: string }
  // A terminal event names its request: one that arrives after a reset or for
  // another request is stale and ignored.
  | { type: "applied"; requestId?: string }
  | { type: "failed"; failure: TrayFailure; requestId?: string };

// Edits are refused while a request is in flight; any other edit makes the next
// Apply a different request.
const edited = (state: TrayState, patch: Partial<TrayState>): TrayState => ({
  ...state,
  ...patch,
  requestId: null,
  failure: null,
});

export function trayReducer(state: TrayState, event: TrayEvent): TrayState {
  if (event.type === "open") return { ...state, open: event.open };
  if (event.type === "apply")
    return {
      ...state,
      applying: true,
      failure: null,
      requestId: state.requestId ?? event.requestId,
    };
  if (event.type === "reset" || event.type === "discard") return EMPTY_TRAY;
  if (event.type === "applied" || event.type === "failed") {
    if (event.requestId !== undefined && event.requestId !== state.requestId)
      return state;
    if (event.type === "applied") return EMPTY_TRAY;
    // Only an unknown failure may have committed on the server, so only it
    // keeps the id (Retry resends the same request); a refusal did nothing.
    return {
      ...state,
      applying: false,
      failure: event.failure,
      requestId: event.failure === "request" ? state.requestId : null,
    };
  }
  if (state.applying) return state;
  switch (event.type) {
    case "stage": {
      if (state.items.length >= MAX_STAGED_IMAGES)
        return { ...state, failure: "image_count" };
      return edited(state, {
        items: [...state.items, event.shot],
        // The first image decides what the tray is for; later ones keep it.
        intent:
          state.items.length === 0 && event.intent
            ? event.intent
            : state.intent,
        open: true,
      });
    }
    case "remove":
      return edited(state, {
        items: state.items.filter((item) => item.id !== event.id),
      });
    case "move": {
      const from = state.items.findIndex((item) => item.id === event.id);
      const to = from + event.by;
      if (from < 0 || to < 0 || to >= state.items.length) return state;
      const next = [...state.items];
      const [moved] = next.splice(from, 1);
      if (!moved) return state;
      next.splice(to, 0, moved);
      return edited(state, { items: next });
    }
    case "crop":
      return edited(state, {
        items: state.items.map((item) =>
          item.id === event.id ? { ...item, blob: event.blob } : item,
        ),
      });
    case "intent":
      return edited(state, { intent: event.intent });
  }
}

// Whether the tray is showing: an explicit choice, else open in Manual and
// closed in Auto until something is staged.
export const trayOpen = (state: TrayState, mode: "auto" | "manual"): boolean =>
  state.open ?? (mode === "manual" || state.items.length > 0);

// Apply is the one way to generate. With a task it can also force a plain
// regeneration (nothing staged); without one it needs at least one image.
export const canApply = (input: {
  state: TrayState;
  hasTarget: boolean;
  deviceOnly: boolean;
}): boolean => {
  const { state } = input;
  if (state.applying) return false;
  if (state.items.length === 0)
    return input.hasTarget && state.intent === "add";
  return !input.deviceOnly;
};

// The intent in force: with no task to add to, a tray is always a new problem.
export const effectiveIntent = (
  state: TrayState,
  hasTarget: boolean,
): TrayIntent => (hasTarget ? state.intent : "new");

// What Apply sends, in words; it follows the session's setting (D35).
export function sendsLine(
  count: number,
  deviceOnly: boolean,
  setting: LiveScreenshotSend = "always",
): string {
  if (deviceOnly)
    return "Device-only: no screenshot leaves this device, so none can be applied.";
  if (count === 0)
    return "Nothing staged. Apply regenerates without new context.";
  return sendsSentence(count, setting);
}

// What the server recorded for a screenshot (D35): the one table lives in
// screenshot-send.ts and is re-exported here for the tray's readers.
export { SENT_AS_LABEL };
export type SentAs = LiveScreenshotSent;
