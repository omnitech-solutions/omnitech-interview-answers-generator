// The native shell's presentation: `window.studioHost.presentation`, negotiated
// by the contract and wrapped so a failing bridge call is a refusal (false),
// never an exception in a panel.
import {
  negotiatePresentation,
  type PresentationHost,
} from "@omnitech/interview-contracts";

export function nativePresentation(): PresentationHost | null {
  if (typeof window === "undefined") return null;
  const bridge = window.studioHost as { presentation?: unknown } | undefined;
  const host = negotiatePresentation(bridge?.presentation);
  if (!host) return null;
  const attempt = async (call: () => Promise<boolean>): Promise<boolean> => {
    try {
      return (await call()) === true;
    } catch {
      return false;
    }
  };
  return {
    capabilities: host.capabilities,
    open: (panel) => attempt(() => host.open(panel)),
    close: (panel) => attempt(() => host.close(panel)),
    focus: (panel) => attempt(() => host.focus(panel)),
    openPanels: () => {
      try {
        return host.openPanels();
      } catch {
        return [];
      }
    },
    setLayout: (layout) => attempt(() => host.setLayout(layout)),
    setVisible: (visible) => attempt(() => host.setVisible(visible)),
    interactionMode: () => {
      try {
        return host.interactionMode() !== false;
      } catch {
        return true;
      }
    },
    setInteractionMode: (on) => attempt(() => host.setInteractionMode(on)),
    onInteractionMode: (listener) => {
      try {
        return host.onInteractionMode(listener);
      } catch {
        return () => undefined;
      }
    },
    // The optional extras pass through only when the shell has them.
    ...(host.appMode
      ? {
          appMode: () => {
            try {
              return host.appMode?.() === "minified"
                ? ("minified" as const)
                : ("expanded" as const);
            } catch {
              return "expanded" as const;
            }
          },
        }
      : {}),
    ...(host.setAppMode
      ? {
          setAppMode: (mode: "expanded" | "minified") =>
            attempt(() => host.setAppMode?.(mode) ?? Promise.resolve(false)),
        }
      : {}),
    ...(host.setHotkeysEnabled
      ? {
          setHotkeysEnabled: (on: boolean) =>
            attempt(
              () => host.setHotkeysEnabled?.(on) ?? Promise.resolve(false),
            ),
        }
      : {}),
    ...(host.opacity ? { opacity: () => host.opacity?.() ?? 1 } : {}),
    ...(host.setOpacity
      ? {
          setOpacity: (value: number) =>
            attempt(() => host.setOpacity?.(value) ?? Promise.resolve(false)),
        }
      : {}),
    ...(host.setWindowWidth
      ? {
          setWindowWidth: (width: number) =>
            attempt(
              () => host.setWindowWidth?.(width) ?? Promise.resolve(false),
            ),
        }
      : {}),
  };
}
