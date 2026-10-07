// Where a portalled library surface (menu, popover, tooltip, dialog) is drawn:
// inside the panel root, so it shares the window's glass, theme and see-through
// tokens and stays inside the page the native shell hit-tests. The surfaces
// carry `data-oui-surface`, which the hit regions already list.
import { useCallback, useState } from "react";

// The native panels, or the web card's own root (which may live in the
// Picture-in-Picture window, whose document is not the global one).
const PANEL_ROOT = ".pn-root, .ov-root";

// Pass `ref` to the trigger element; `container` is the closest panel root, or
// undefined (the library then uses document.body) outside the native panels.
export function usePortalRoot(): {
  ref: (element: HTMLElement | null) => void;
  container: HTMLElement | null;
} {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    if (element) setContainer(element.closest<HTMLElement>(PANEL_ROOT));
  }, []);
  return { ref, container };
}
