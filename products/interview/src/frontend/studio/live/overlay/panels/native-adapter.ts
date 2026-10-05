// The native shell's presentation: `window.studioHost.presentation`, negotiated
// by the contract and wrapped so a failing bridge call is a refusal (false),
// never an exception in a window.
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
    openSettings: () => attempt(() => host.openSettings()),
    closeSettings: () => attempt(() => host.closeSettings()),
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
    ...(host.setWindowSize
      ? {
          setWindowSize: (size: { width: number; height?: number }) =>
            attempt(() => host.setWindowSize?.(size) ?? Promise.resolve(false)),
        }
      : {}),
    ...(host.quit
      ? { quit: () => attempt(() => host.quit?.() ?? Promise.resolve(false)) }
      : {}),
  };
}
