// The overlay route with `?panel=single|settings`, the two pages the native
// shell loads: the one compact window (toolbar, chat, answer and code) and the
// small Settings window beside it. The card is the default of the route and is
// untouched.
//
// [SAFETY] Signed out or unavailable: a message, no panel; the store stops.
import type { ProductMember } from "@omnitech/platform-contracts";
import { useEffect, useMemo, useRef } from "react";
import { Icon } from "../../../icon";
import { type OverlayAccess, overlayAccess } from "../../float-access";
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
import { StartPanel } from "./start-panel";
import { SeeThroughButton } from "./toolbar";
import { usePanelSession } from "./use-panel-session";
import { usePanelWindowMode } from "./window-mode";

const WINDOW_TITLE: Record<NativeWindowPage, string> = {
  single: "Live session",
  settings: "Settings",
};

// How many times the window re-reads on its own after losing its session.
const MAX_RECOVERIES = 3;

export function PanelsRoot({
  panel,
  member,
  signedOut = false,
}: {
  panel: NativeWindowPage;
  // Who is signed in (the account chip and the welcome line).
  member?: ProductMember;
  // The public native sign-in route: no session to read, so the window opens on
  // the sign-in screen whatever the store says.
  signedOut?: boolean;
}) {
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
  const access: OverlayAccess = signedOut
    ? "signed-out"
    : overlayAccess(snapshot, tenantFromLocation());
  const requested = params.get("session");
  const opened = useRef(false);
  const native = isNativeSurface(params, presentation.capabilities.length);
  // A native window adopts a running session and shows the start screen when
  // there is none; it starts one only from that screen's Start button.
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
  // [SAFETY] A native window is never left on a dead end: a session that went away
  // (ended elsewhere, deleted, a stale id) halts the store, and nothing else would
  // restart it. Read the current session again: a running one is adopted, none shows
  // the start screen. Bounded, so a server that keeps refusing shows the card.
  const recoveries = useRef(0);
  useEffect(() => {
    if (access === "ok") recoveries.current = 0;
    else if (
      native &&
      panel === "single" &&
      access === "unavailable" &&
      snapshot.tenant === tenantFromLocation() &&
      recoveries.current < MAX_RECOVERIES
    ) {
      recoveries.current += 1;
      void actions.refresh();
    }
  }, [access, native, panel, snapshot.tenant, actions]);

  // [SAFETY] The compact native window never draws without its toolbar. Whatever
  // is wrong (signed out, the session gone, the store still loading, no session),
  // it is the start screen inside the real toolbar and footer, with the reason
  // said on it. Only a live session draws the session window.
  const live = access === "ok" && snapshot.session !== null;
  // The reason stays on the start screen after the window recovered from the loss,
  // until a session is showing again.
  const lostSession = useRef(false);
  if (live) lostSession.current = false;
  else if (access === "unavailable") lostSession.current = true;
  if (native && panel === "single" && !live)
    return (
      <div
        className="pn-root"
        data-panel={panel}
        data-access={access}
        data-testid="pn-start-root"
        {...look}
      >
        <StartPanel
          s={s}
          controls={{ panes, presentation, glass, windowMode }}
          signedIn={access !== "signed-out"}
          member={member ?? null}
          expired={
            access === "signed-out" &&
            (!signedOut || params.get("notice") === "expired")
          }
          notice={
            access === "unavailable" || lostSession.current
              ? "unavailable"
              : params.get("notice") === "signed-out"
                ? "signed-out"
                : null
          }
          onStarted={autoSession.announceStarted}
        />
        {toastsHere && <Toasts s={s} />}
      </div>
    );
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
          {access === "signed-out" && (
            <a className="pn-bar-button" href="/sign-in">
              Sign in
            </a>
          )}
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
              : native && autoSession.state === "consent"
                ? "Consent required"
                : "No live session."}
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
