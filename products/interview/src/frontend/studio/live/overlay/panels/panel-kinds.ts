// The four focused views of the one overlay route (`?panel=`). Each is the same
// session implementation shown differently; the default (no `panel`) is the
// compact card and is unchanged.
import {
  PRESENTATION_PANELS,
  type PresentationPanel,
} from "@omnitech/interview-contracts";

export const PANELS = PRESENTATION_PANELS;
export type PanelKind = PresentationPanel;

export const PANEL_LABEL: Record<PanelKind, string> = {
  pill: "Control bar",
  analysis: "Analysis",
  chat: "Live Transcription & Chat",
  settings: "Settings",
};

// A closed value or null: an unknown `panel` is the card, never an error.
export function parsePanel(search: string): PanelKind | null {
  const value = new URLSearchParams(search).get("panel");
  return PANELS.find((panel) => panel === value) ?? null;
}

// The minimized single window: not one of the four panels, one frame holding them.
export const isSinglePanel = (search: string): boolean =>
  new URLSearchParams(search).get("panel") === "single";
