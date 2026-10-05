// The overlay route with `?panel=single|settings`, the two pages the native
// shell loads: the one compact window (toolbar, chat, answer and code) and the
// small Settings window beside it. The card is the default of the route and is
// untouched.
//
// [SAFETY] Signed out or unavailable: a message, no panel; the store stops.
import { useEffect, useMemo, useRef } from "react";
import { Icon } from "../../../icon";
import { overlayAccess } from "../../float-access";
import { holdAwake } from "../../keep-awake";
import { tenantFromLocation } from "../../session-registry";
import { useLiveSession } from "../../use-live-session";
import { installHostSurface, isNativeSurface } from "../host-surface";
import { tellHost } from "../overlay-url";
import { useAutoSession } from "./auto-session";
import { canPassThrough, useHitRegions } from "./hit-regions";
import { glassAttributes, usePanelGlass } from "./panel-glass";
import type { NativeWindowPage } from "./panel-owner";
import { SettingsPanel, Toasts } from "./panel-views";
import { selectPresentation } from "./presentation-host";
import { nativeToastsDrawn, openShellConsent } from "./shell-bridge";
import { SinglePanel, usePanes } from "./single-panel";
import { SeeThroughButton } from "./toolbar";
import { usePanelSession } from "./use-panel-session";
import { usePanelWindowMode } from "./window-mode";

const WINDOW_TITLE: Record<NativeWindowPage, string> = {
  single: "Live session",
  settings: "Settings",
};

export function PanelsRoot({ panel }: { panel: NativeWindowPage }) {
  const params = new URLSearchParams(window.location.search);
  const presentation = useMemo(() => selectPresentation(), []);
  const { snapshot, actions } = useLiveSession();
  const panes = usePanes();
  const glass = usePanelGlass();
  const windowMode = usePanelWindowMode(presentation);
  const look = glassAttributes(glass);
  // Auto (the one preference) watches the screen while the analysis shows.
  const s = usePanelSession(panel, presentation, {
    watchScreen: panel === "single" && panes.shown.analysis,
    toggleSeeThrough: glass.toggle,
  });
  // See-through on: the shell takes the mouse only over the surfaces reported here.
  useHitRegions(presentation, panel === "single" && glass.clear);
  const access = overlayAccess(snapshot, tenantFromLocation());
  const requested = params.get("session");
  const opened = useRef(false);
  const native = isNativeSurface(params, presentation.capabilities.length);
  // A native window starts its own session; it never sends the person away.
  const autoSession = useAutoSession({
    panel,
    enabled: native && access === "ok" && snapshot.hydration === "ready",
    snapshot,
    actions,
  });
  // The shell draws its own toasts; any other window (a browser tab) draws them here.
  const toastsHere = !nativeToastsDrawn();

  // A native window is always in view of the person, so it keeps reading the
  // session even when its window is covered by another app's.
  useEffect(() => (native ? holdAwake() : undefined), [native]);
  useEffect(() => {
    document.title = `Interview Studio · ${WINDOW_TITLE[panel]}`;
    return installHostSurface(native);
  }, [panel, native]);
  useEffect(() => {
    if (!requested || opened.current || snapshot.hydration !== "ready") return;
    opened.current = true;
    if (snapshot.session?.id !== requested)
      void actions.switchSession(requested);
  }, [requested, snapshot.hydration, snapshot.session?.id, actions]);
  useEffect(() => {
    if (access !== "ok") tellHost("lost");
  }, [access]);

  if (access !== "ok")
    return (
      <div
        className="pn-root"
        data-panel={panel}
        data-access={access}
        {...look}
      >
        <p className="pn-card pn-unavailable" role="alert">
          <Icon name={access === "signed-out" ? "lock" : "warning"} />
          {access === "signed-out"
            ? "You’re signed out. Sign in to Studio again to continue."
            : "This session is unavailable."}
        </p>
      </div>
    );
  if (!snapshot.session)
    return (
      <div
        className="pn-root"
        data-panel={panel}
        data-testid="pn-empty"
        {...look}
      >
        <div
          className={panel === "single" ? "pn-pill" : "pn-card"}
          aria-busy={snapshot.hydration !== "ready"}
        >
          <span className="pn-muted">
            {snapshot.hydration !== "ready"
              ? "Loading…"
              : !native
                ? "No live session."
                : autoSession.state === "consent"
                  ? "Consent required"
                  : autoSession.state === "failed"
                    ? "Couldn’t start a session."
                    : "Starting…"}
          </span>
          {native && autoSession.state === "consent" && (
            <button
              type="button"
              className="pn-bar-button"
              onClick={() => void openShellConsent()}
            >
              Review consent
            </button>
          )}
          {native && autoSession.state === "failed" && (
            <button
              type="button"
              className="pn-bar-button"
              onClick={autoSession.retry}
            >
              Try again
            </button>
          )}
          {/* Clear glass chosen earlier can be turned off with no session. */}
          {native && panel === "single" && (
            <SeeThroughButton
              glass={glass}
              passThrough={canPassThrough(presentation)}
            />
          )}
        </div>
      </div>
    );

  return (
    <div
      className="pn-root"
      data-panel={panel}
      data-testid="pn-root"
      data-window-mode={panel === "single" ? windowMode.mode : undefined}
      {...look}
    >
      {panel === "single" ? (
        <SinglePanel
          s={s}
          panes={panes}
          presentation={presentation}
          glass={glass}
          windowMode={windowMode}
        />
      ) : (
        <SettingsPanel s={s} presentation={presentation} />
      )}
      {toastsHere && <Toasts s={s} />}
    </div>
  );
}
