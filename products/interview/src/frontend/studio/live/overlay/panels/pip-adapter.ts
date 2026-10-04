// Document Picture-in-Picture as a presentation: ONE window, so the pill plus
// the one active panel. It wraps the existing float host rather than replacing
// it: "setVisible(false)" asks the float host to close the window (the same
// message the card's "Back to Studio" sends). Fewer capabilities: no
// multi-panel, no click-through. Opening a panel replaces the active one.
import type {
  PresentationHost,
  PresentationLayout,
  PresentationPanel,
} from "@omnitech/interview-contracts";

export type PipStack = {
  host: PresentationHost;
  // The panel shown under the pill, or null.
  active(): PresentationPanel | null;
  subscribe(listener: () => void): () => void;
};

export function createPipPresentation(options: {
  // Asks the embedding float host to close the window.
  closeWindow(): void;
}): PipStack {
  let active: PresentationPanel | null = null;
  const listeners = new Set<() => void>();
  const set = (next: PresentationPanel | null) => {
    if (next === active) return;
    active = next;
    for (const listener of listeners) listener();
  };
  // The pill is always there; every other panel takes the one slot.
  const show = async (panel: PresentationPanel) => {
    if (panel !== "pill") set(panel);
    return true;
  };
  const host: PresentationHost = {
    capabilities: [],
    open: show,
    focus: show,
    close: async (panel) => {
      if (panel === "pill") return false;
      if (active === panel) set(null);
      return true;
    },
    openPanels: () => (active ? ["pill", active] : ["pill"]),
    // One window: a layout can only choose what sits under the pill.
    setLayout: async (layout: PresentationLayout) => {
      set(layout === "reading" ? "analysis" : layout === "all" ? "chat" : null);
      return true;
    },
    setVisible: async (visible) => {
      if (!visible) options.closeWindow();
      return !visible;
    },
    interactionMode: () => true,
    setInteractionMode: async () => false,
    onInteractionMode: () => () => undefined,
  };
  return {
    host,
    active: () => active,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
