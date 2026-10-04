// The floating window: Focus in a Document Picture-in-Picture window, mounted
// by a portal under the persistent Studio live view. Selection and pinning
// live in focus-presentation, above the portal. Without the API (or when the
// browser refuses) the presentation falls back to Focus in the tab.
//
// [SAFETY] The float closes, and its content unmounts, the moment the session
// or the right to see it is gone (floatAccessLost), when the page unloads
// (pagehide), and when this host unmounts. Closing it only changes layout:
// nothing here pauses, ends or purges.
import { useEffect, useReducer, useState } from "react";
import { createPortal } from "react-dom";
import { floatAccessLost } from "./float-access";
import { FocusView } from "./focus-view";
import { presentation, usePresentation } from "./focus-presentation";
import { copyStyles, documentVisibility, pipApi } from "./pip-document";
import { getSessionStore, tenantFromLocation } from "./session-registry";
import { useLiveSession } from "./use-live-session";

const FLOAT_SIZE = { width: 420, height: 640 };

export function LiveFloatHost() {
  const { snapshot } = useLiveSession();
  const { mode, float } = usePresentation();
  const [container, setContainer] = useState<HTMLElement | null>(null);
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

  useEffect(() => {
    if (mode !== "floating") return;
    const api = pipApi();
    if (!api) {
      presentation.setFloat("fallback");
      return;
    }
    let cancelled = false;
    let pip: Window | null = null;
    let unwatch = () => {};
    const closeLayout = () => presentation.closeFloat();
    presentation.setFloat("opening");
    api.requestWindow(FLOAT_SIZE).then(
      (opened) => {
        if (cancelled) {
          opened.close();
          return;
        }
        pip = opened;
        copyStyles(document, opened.document);
        const root = opened.document.createElement("div");
        root.className = "live-float-root";
        opened.document.body.append(root);
        unwatch = getSessionStore(tenantFromLocation()).watchDocument(
          documentVisibility(opened.document),
        );
        // The person closed the window: layout only.
        opened.addEventListener("pagehide", closeLayout);
        setContainer(root);
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
      unwatch();
      setContainer(null);
      if (pip) {
        pip.removeEventListener("pagehide", closeLayout);
        pip.close();
      }
      presentation.setFloat("closed");
    };
  }, [mode]);

  if (mode !== "floating" || float !== "pip" || !container || lost) return null;
  return createPortal(<FocusView variant="float" />, container);
}
