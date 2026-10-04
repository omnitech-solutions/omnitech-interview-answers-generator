// The overlay route with `?panel=pill|analysis|chat|settings`: one focused panel
// of the same session (the card is the default and is untouched). In the PiP
// window (`host=pip`) there is one window, so it shows the pill with the one
// active panel under it, the PiP adapter's mapping of the same four panels.
//
// [SAFETY] Signed out or unavailable: a message, no panel; the store stops.
import { type PresentationHost } from "@omnitech/interview-contracts";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Icon } from "../../../icon";
import { overlayAccess } from "../../float-access";
import { tenantFromLocation } from "../../session-registry";
import { useLiveSession } from "../../use-live-session";
import { installHostSurface, isNativeSurface } from "../host-surface";
import { tellHost } from "../overlay-url";
import { PANEL_LABEL, type PanelKind } from "./panel-kinds";
import {
  AnalysisPanel,
  ChatPanel,
  type PanelSession,
  PillPanel,
  SettingsPanel,
  Toasts,
} from "./panel-views";
import { createPipPresentation } from "./pip-adapter";
import { selectPresentation } from "./presentation-host";
import { usePanelSession } from "./use-panel-session";

function View({
  panel,
  s,
  presentation,
}: {
  panel: PanelKind;
  s: PanelSession;
  presentation: PresentationHost;
}) {
  if (panel === "pill") return <PillPanel s={s} presentation={presentation} />;
  if (panel === "analysis") return <AnalysisPanel s={s} />;
  if (panel === "chat") return <ChatPanel s={s} />;
  return <SettingsPanel s={s} presentation={presentation} />;
}

export function PanelsRoot({ panel }: { panel: PanelKind }) {
  const params = new URLSearchParams(window.location.search);
  const embedded = params.get("host") === "pip";
  const stack = useMemo(
    () =>
      embedded
        ? createPipPresentation({ closeWindow: () => tellHost("close") })
        : null,
    [embedded],
  );
  const active = useSyncExternalStore(
    stack?.subscribe ?? (() => () => undefined),
    stack?.active ?? (() => null),
  );
  const presentation = useMemo(
    () => selectPresentation(stack?.host ?? null),
    [stack],
  );
  const { snapshot, actions } = useLiveSession();
  const s = usePanelSession(panel, presentation);
  const access = overlayAccess(snapshot, tenantFromLocation());
  const requested = params.get("session");
  const opened = useRef(false);

  useEffect(() => {
    document.title = `Interview Studio · ${PANEL_LABEL[panel]}`;
    return installHostSurface(
      isNativeSurface(params, presentation.capabilities.length),
    );
  }, [panel, presentation, params]);
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
      <div className="pn-root" data-panel={panel} data-access={access}>
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
      <div className="pn-root" data-panel={panel} data-testid="pn-empty">
        <p
          className="pn-card pn-muted"
          aria-busy={snapshot.hydration !== "ready"}
        >
          {snapshot.hydration !== "ready" ? "Loading…" : "No live session."}
        </p>
      </div>
    );

  return (
    <div className="pn-root" data-panel={panel} data-testid="pn-root">
      {stack ? (
        <>
          <PillPanel s={s} presentation={presentation} />
          {active && <View panel={active} s={s} presentation={presentation} />}
        </>
      ) : (
        <View panel={panel} s={s} presentation={presentation} />
      )}
      <Toasts s={s} />
    </div>
  );
}
