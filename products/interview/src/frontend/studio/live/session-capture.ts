// The owner's capture-and-analyze input and the hints sent with it and with a
// typed follow-up. Types only: the closed lists and labels live in the
// contracts package.
import type {
  LiveCaptureMode,
  LiveCaptureRegion,
  LiveOwnerLanguage,
  LiveOwnerSkill,
} from "@omnitech/interview-contracts";

export type OwnerHints = {
  skill?: LiveOwnerSkill | undefined;
  language?: LiveOwnerLanguage | undefined;
};

// A frame the browser took and cropped itself. `label` is plain text such as
// "Window · region": never the title of the window or tab.
export type CaptureInput = OwnerHints & {
  image: Blob;
  label?: string | undefined;
  target?: { taskId: string; revision: number } | undefined;
};

// Asking the native companion to capture once: the focused window, a region of
// the main display, or the whole display. The region is normalised to the main
// display and present exactly when the mode is "region".
export type CompanionCaptureInput = OwnerHints & {
  mode: LiveCaptureMode;
  region?: LiveCaptureRegion | undefined;
  target?: { taskId: string; revision: number } | undefined;
};
