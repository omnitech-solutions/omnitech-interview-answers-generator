// The owner's capture-and-analyze input and the hints sent with it and with a
// typed follow-up. Types only: the closed lists and labels live in the
// contracts package.
import type {
  LiveCaptureDisplay,
  LiveCaptureMode,
  LiveCaptureRegion,
  LiveOcrBlock,
  LiveOwnerLanguageHint,
  LiveOwnerSkillHint,
} from "@omnitech/interview-contracts";

export type OwnerHints = {
  // "auto" resets an earlier hint; omitted keeps it.
  skill?: LiveOwnerSkillHint | undefined;
  language?: LiveOwnerLanguageHint | undefined;
};

// A frame the browser took and cropped itself. `label` is plain text such as
// "Window · region": never the title of the window or tab.
export type CaptureInput = OwnerHints & {
  image: Blob;
  label?: string | undefined;
  target?: { taskId: string; revision: number } | undefined;
  // The text the shell read from this frame on the device, with its metrics.
  ocr?: LiveOcrBlock | null | undefined;
};

// "Apply" on the answer page: the images the owner staged on the device (already
// cropped, in the order they chose), sent as ONE request. `requestId` is the
// dedup key: the caller makes one per Apply and reuses it for a retry. With a
// target the result is one new revision of that task; without, one new task
// (at least one image). `ocr` is the text read from each image on the device,
// aligned by index (null: none); `display` is the label of the display each
// image came from, aligned the same way.
export type ApplyContextInput = OwnerHints & {
  requestId: string;
  images: readonly Blob[];
  ocr?: readonly (LiveOcrBlock | null)[] | undefined;
  // The display each image was captured on, aligned by index (null: unknown).
  display?: readonly (LiveCaptureDisplay | null)[] | undefined;
  label?: string | undefined;
};

// Asking the native companion to capture once: the focused window, a region of
// the main display, or the whole display. The region is normalised to the main
// display and present exactly when the mode is "region".
export type CompanionCaptureInput = OwnerHints & {
  mode: LiveCaptureMode;
  region?: LiveCaptureRegion | undefined;
  // The companion's screen-selection token the region was drawn against.
  selection?: string | undefined;
  target?: { taskId: string; revision: number } | undefined;
};
