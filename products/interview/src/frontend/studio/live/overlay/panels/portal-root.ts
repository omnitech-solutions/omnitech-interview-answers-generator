// Where a portalled library surface (menu, popover, tooltip, dialog) is drawn:
// inside the panel root, so it shares the window's glass, theme and see-through
// tokens and stays inside the page the native shell hit-tests. The surfaces
// carry `data-oui-surface`, which the hit regions already list.
import { useCallback, useState } from "react";

const PANEL_ROOT = ".pn-root";

// Pass `ref` to the trigger element; `container` is the closest panel root, or
// undefined (the library then uses document.body) outside the native panels.
export function usePortalRoot(): {
  ref: (element: HTMLElement | null) => void;
  container: HTMLElement | undefined;
} {
  const [container, setContainer] = useState<HTMLElement | undefined>();
  const ref = useCallback((element: HTMLElement | null) => {
    if (element)
      setContainer(element.closest<HTMLElement>(PANEL_ROOT) ?? undefined);
  }, []);
  return { ref, container };
}
