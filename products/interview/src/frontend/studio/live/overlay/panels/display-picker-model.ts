// The screen picker as data: the button's name and tooltip, the menu's rows from
// what the host listed, how often the live thumbnails refresh, and the words for
// every state. No React and no bridge here, so each rule is a table test.
import { displayLabel } from "@omnitech/interview-contracts";
import type { DisplayChoice, DisplayListing } from "../../host-adapter";
import type { CaptureSource } from "../../host-display";
import { SCREEN_CONTROL } from "./toolbar-config";

// Live thumbnails refresh at most this often while the menu is open.
export const DISPLAY_REFRESH_MS = 2000;

// How long until the next list request may start: never sooner than the
// refresh period after the previous one started.
export const nextRefreshDelay = (startedAt: number, now: number): number =>
  Math.max(0, startedAt + DISPLAY_REFRESH_MS - now);

export const PIN_DROPPED_NOTE =
  "The pinned display was disconnected. Following your browser again.";

export const SCREEN_HELP = {
  loading: "Looking for displays…",
  none: "No displays found",
  "capture-failed": "Could not read the displays",
  "permission-denied": "Screen recording is not allowed",
  permissionHelp: "Grant Screen Recording to the app",
} as const;

// "Following your browser" or "Pinned: Display 2 of 3".
export function choiceText(source: CaptureSource): string {
  if (!source.pinned) return "Following your browser";
  return source.display
    ? `Pinned: ${displayLabel(source.display)}`
    : "Pinned to a display";
}

// The button's name always carries the current choice; the tooltip repeats it.
export const screenButtonName = (source: CaptureSource): string =>
  `${SCREEN_CONTROL.label}: ${choiceText(source)}`;

// What the capture will target, for the capture button's tooltip: "following
// your browser", or the pinned display ("Display 2 of 3 (pinned)").
// [SAFETY] A display, never an app or a window title.
export const captureTargetText = (source: CaptureSource): string => {
  if (!source.pinned) return "following your browser";
  return source.display
    ? `${displayLabel(source.display)} (pinned)`
    : "a pinned display";
};

// The capture button's tooltip when the host can choose a screen: what pressing
// does, the target, and the key. `action` is the control's own title.
export const captureButtonTitle = (
  action: string,
  source: CaptureSource,
  chord: string,
): string => `${action}: ${captureTargetText(source)}, ${chord}`;

// ---- The list the menu shows ---------------------------------------------------

export type ListState =
  | { kind: "loading" }
  | { kind: "ready"; displays: DisplayChoice[] }
  | { kind: "failed"; reason: "permission-denied" | "capture-failed" };

export const LOADING: ListState = { kind: "loading" };

// What a response does to the list on show. A failure keeps nothing; a success
// replaces the list wholesale.
export const listStateOf = (listing: DisplayListing): ListState =>
  listing.ok
    ? { kind: "ready", displays: listing.displays }
    : { kind: "failed", reason: listing.reason };

export type PickerRow =
  | { kind: "follow"; label: string; sub: string; checked: boolean }
  | {
      kind: "display";
      id: number;
      name: string;
      position: string;
      thumbnailSrc: string;
      checked: boolean;
    };

// "Follow my browser" first, then one row per display, in the shell's order.
export function pickerRows(
  list: ListState,
  source: CaptureSource,
): PickerRow[] {
  const follow: PickerRow = {
    kind: "follow",
    label: SCREEN_CONTROL.followLabel,
    sub: SCREEN_CONTROL.followSub,
    checked: !source.pinned,
  };
  if (list.kind !== "ready") return [follow];
  return [
    follow,
    ...list.displays.map(
      ({ display, thumbnailSrc }): PickerRow => ({
        kind: "display",
        id: display.id,
        name: display.name,
        position: `${display.index} of ${display.count}`,
        thumbnailSrc,
        checked: source.pinned && source.pinnedId === display.id,
      }),
    ),
  ];
}

// The honest line under the rows when the list is not a list of displays.
export function listNotice(list: ListState): {
  text: string;
  help?: string;
} | null {
  switch (list.kind) {
    case "loading":
      return { text: SCREEN_HELP.loading };
    case "failed":
      return list.reason === "permission-denied"
        ? {
            text: SCREEN_HELP["permission-denied"],
            help: SCREEN_HELP.permissionHelp,
          }
        : { text: SCREEN_HELP["capture-failed"] };
    case "ready":
      return list.displays.length === 0 ? { text: SCREEN_HELP.none } : null;
  }
}
