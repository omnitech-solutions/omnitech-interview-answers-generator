// The floating window: a Document Picture-in-Picture window that loads the
// chromeless overlay route (overlay/overlay-page.tsx) in an iframe filling it.
// The route is its own page: its own session store, polling and auth (same
// origin, same cookies), so it keeps running while this page is in the
// background and Chrome throttles it. Without the API (or when the browser
// refuses) the presentation falls back to the card in the tab.
//
// [SAFETY] The float closes the moment the session or the right to see it is
// gone (floatAccessLost here, and the overlay page's own access rules, which
// it reports to this host by message), when this page unloads (pagehide), when
// the person closes the window, and when this host unmounts. Closing it only
// changes layout: nothing here pauses, ends or purges.
import { useEffect, useReducer } from "react";
import { parseRoute } from "../use-studio-route";
import { floatAccessLost } from "./float-access";
import { presentation, usePresentation } from "./focus-presentation";
import { listenForIntents } from "./overlay/overlay-intents";
import { OVERLAY_MESSAGE, overlayUrl } from "./overlay/overlay-url";
import { navigateStudio } from "./overlay/studio-links";
import { pipApi } from "./pip-document";
import { tenantFromLocation } from "./session-registry";
import { useLiveSession } from "./use-live-session";

const FLOAT_SIZE = { width: 420, height: 640 };

export function LiveFloatHost() {
  const { snapshot } = useLiveSession();
  const { mode } = usePresentation();
  // A tenant switch changes the address, not this component's inputs.
  const [, recheck] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    window.addEventListener("popstate", recheck);
    return () => window.removeEventListener("popstate", recheck);
  }, []);

  const lost = floatAccessLost(snapshot, tenantFromLocation());
  useEffect(() => {
    if (lost && mode !== "full") presentation.reset();
  }, [lost, mode]);
  // The host is mounted by the Studio shell, so the float outlives any one
  // page; it closes when the shell goes away.
  useEffect(() => () => presentation.reset(), []);

  // Navigation intents from the overlay page (the PiP or a standalone window):
  // places only, never session control.
  useEffect(
    () =>
      listenForIntents(() => parseRoute(window.location).base, navigateStudio),
    [],
  );

  useEffect(() => {
    if (mode !== "floating") return;
    const api = pipApi();
    if (!api) {
      presentation.setFloat("fallback");
      return;
    }
    let cancelled = false;
    let pip: Window | null = null;
    const closeLayout = () => presentation.closeFloat();
    // The overlay page asks to close (Back to Studio) or reports it lost
    // access. It runs in an iframe of the PiP document, so its `parent` is the
    // PiP window and the message lands there, not on this window; only
    // messages from its own iframe are heard.
    let frame: HTMLIFrameElement | null = null;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame?.contentWindow) return;
      const data = event.data as { kind?: string; event?: string } | null;
      if (
        data?.kind === OVERLAY_MESSAGE &&
        (data.event === "close" || data.event === "lost")
      )
        closeLayout();
    };
    presentation.setFloat("opening");
    api.requestWindow(FLOAT_SIZE).then(
      (opened) => {
        if (cancelled) {
          opened.close();
          return;
        }
        pip = opened;
        const doc = opened.document;
        doc.body.style.margin = "0";
        doc.body.style.height = "100vh";
        doc.body.style.overflow = "hidden";
        frame = doc.createElement("iframe");
        frame.title = "Live session overlay";
        frame.src = overlayUrl("pip");
        // Display capture: the overlay page shares a window, tab or screen from the
        // PiP's own document, so the iframe must be allowed to ask for it.
        frame.setAttribute("allow", "clipboard-write; display-capture");
        frame.style.cssText =
          "border:0;width:100%;height:100%;display:block;color-scheme:dark";
        doc.body.append(frame);
        // The person closed the window: layout only.
        opened.addEventListener("pagehide", closeLayout);
        opened.addEventListener("message", onMessage);
        presentation.setFloat("pip");
      },
      () => {
        if (!cancelled) presentation.setFloat("fallback");
      },
    );
    window.addEventListener("pagehide", closeLayout);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", closeLayout);
      frame?.remove();
      if (pip) {
        pip.removeEventListener("pagehide", closeLayout);
        pip.removeEventListener("message", onMessage);
        pip.close();
      }
      presentation.setFloat("closed");
    };
  }, [mode]);

  return null;
}
