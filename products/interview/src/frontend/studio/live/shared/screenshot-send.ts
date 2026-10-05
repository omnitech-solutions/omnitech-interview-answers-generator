// D35 / OBJ-8: the per-session setting "Screenshots to the model", as ONE
// config-driven table plus the small pure rules around it, for the setup page,
// the native Settings window, the web live page and the wording of the
// screenshots tray and labels. No React and no network here.
//
// The server is the authority: it reads the stored setting at each model call
// and records what actually left the device. Wording here never claims more
// than a server record says; a prediction is worded as one ("Will be...").
import {
  LIVE_SCREENSHOT_SEND_MODES,
  type LiveProcessingPolicy,
  type LiveScreenshotSend,
  type LiveScreenshotSent,
  type LiveSessionView,
} from "@omnitech/interview-contracts";

export const SCREENSHOT_SEND_TITLE = "Screenshots to the model";
// A session recorded before the setting existed reads as this.
export const DEFAULT_SCREENSHOT_SEND: LiveScreenshotSend = "always";

export type ScreenshotSendOption = {
  value: LiveScreenshotSend;
  label: string;
  // The one word for a tooltip: "Screenshots to the model: Always".
  short: string;
  description: string;
};

export const SCREENSHOT_SEND_OPTIONS: readonly ScreenshotSendOption[] = [
  {
    value: "always",
    label: "Always send",
    short: "Always",
    description:
      "The screenshot image and the text read from it go to the model.",
  },
  {
    value: "text-only-when-text",
    label: "Text only when the screen is just text",
    short: "Text only when text",
    description:
      "The image is dropped only when the text was read confidently and covers the screen and it is not code; otherwise the image goes too.",
  },
  {
    value: "never",
    label: "Never send images",
    short: "Never",
    description:
      "Only the text read from a screenshot goes to the model, when there is any.",
  },
];

// The table must cover every mode the contract names, once.
export const screenshotSendOption = (
  value: LiveScreenshotSend,
): ScreenshotSendOption =>
  SCREENSHOT_SEND_OPTIONS.find((option) => option.value === value) ??
  (SCREENSHOT_SEND_OPTIONS[0] as ScreenshotSendOption);

export const screenshotSendModesCovered = (): boolean =>
  LIVE_SCREENSHOT_SEND_MODES.length === SCREENSHOT_SEND_OPTIONS.length &&
  LIVE_SCREENSHOT_SEND_MODES.every((mode) =>
    SCREENSHOT_SEND_OPTIONS.some((option) => option.value === mode),
  );

// The saved value of a session: absent reads as the default.
export const savedScreenshotSend = (
  session: Pick<LiveSessionView, "screenshotSend"> | null | undefined,
): LiveScreenshotSend => session?.screenshotSend ?? DEFAULT_SCREENSHOT_SEND;

export const DEVICE_ONLY_REASON =
  "This session is device-only, so no screenshot image is ever sent to a model, whatever this says.";
export const ENDED_REASON =
  "This session has ended, so the setting can no longer change.";
export const SAVING_TEXT = "Saving...";
export const SAVE_FAILED_TEXT =
  "That didn't save. The setting is unchanged; try again.";
export const SAVE_REFUSED_TEXT =
  "The session no longer accepts changes, so the setting is unchanged.";

// Why the control cannot change now, or null when it can. Device-only wins:
// it explains the most.
export function screenshotSendDisabledReason(input: {
  policy: LiveProcessingPolicy | null;
  status: LiveSessionView["status"] | null;
}): string | null {
  if (input.policy === "device-only") return DEVICE_ONLY_REASON;
  if (input.status === "ended" || input.status === "purging")
    return ENDED_REASON;
  return null;
}

// The failure line after a refused save: a closed code, never a message.
export const screenshotSendFailureText = (code: string): string =>
  code === "status_refused" || code === "not_found"
    ? SAVE_REFUSED_TEXT
    : SAVE_FAILED_TEXT;

// "Screenshots to the model: Always" for the screenshots button's tooltip.
export const screenshotSendTooltip = (value: LiveScreenshotSend): string =>
  `${SCREENSHOT_SEND_TITLE}: ${screenshotSendOption(value).short}`;

// ---- What was sent, in words (recorded by the server) -----------------------

export const SENT_AS_LABEL: Record<LiveScreenshotSent, string> = {
  image: "Image sent",
  "text-only": "Sent as text only",
  none: "Not sent",
};

// One line for a screenshot fed to several revisions, e.g.
// "rev 1: Image sent, rev 2: Sent as text only"; null with no record.
export function sentByRevisionLine(
  entries: readonly { revision: number; sent: LiveScreenshotSent }[],
): string | null {
  if (entries.length === 0) return null;
  return entries
    .map((entry) => `rev ${entry.revision}: ${SENT_AS_LABEL[entry.sent]}`)
    .join(", ");
}

// The label a screenshot carries: the NEWEST recorded revision's outcome; null
// when the server recorded none (absent means no label, never a guess).
export function latestSent(
  entries: readonly { revision: number; sent: LiveScreenshotSent }[],
): LiveScreenshotSent | null {
  let newest: { revision: number; sent: LiveScreenshotSent } | null = null;
  for (const entry of entries)
    if (!newest || entry.revision > newest.revision) newest = entry;
  return newest ? newest.sent : null;
}

// ---- What the tray will do (a prediction, worded as one) ---------------------

export const DECIDED_WHEN_SENT = "Decided when sent";
export const WILL_SEND_IMAGE = "Will be sent as image";
export const WILL_SEND_TEXT_ONLY = "Will be sent as text only";
export const WILL_NOT_SEND = "Will not be sent";

// What a staged screenshot will do under the current setting, only when it can
// be known: Always sends the image; Never sends its text (when it has any, which
// is known once reading is done) and otherwise nothing. Text-only depends on the
// server's judgement of the frame, so it is decided when sent.
export function stagedWillBe(input: {
  setting: LiveScreenshotSend | null;
  // The read of this image: "text" found, "none" found, or not known yet.
  text: "text" | "none" | "unknown";
}): string {
  if (input.setting === "always") return WILL_SEND_IMAGE;
  if (input.setting === "never") {
    if (input.text === "text") return WILL_SEND_TEXT_ONLY;
    if (input.text === "none") return WILL_NOT_SEND;
  }
  return DECIDED_WHEN_SENT;
}

// The tray's sentence about what Apply sends, following the setting.
export function sendsSentence(
  count: number,
  setting: LiveScreenshotSend,
): string {
  const shots = `${count} screenshot${count === 1 ? "" : "s"}`;
  if (setting === "never") return `Sends the text read from ${shots}.`;
  if (setting === "text-only-when-text")
    return "May send the image or only its text.";
  return `Sends ${shots} and the text read from ${count === 1 ? "it" : "them"}.`;
}
