// The chromeless overlay route: /t/<tenant>/p/<product>/live/overlay.
// It renders only the card, filling its viewport, and is a page of its own:
// its own session store and polling (same-origin cookies), the switcher and
// every action. It does not depend on the Studio live page being mounted or
// visible, so any host can load it: the PiP window (in an iframe), a native
// shell, or a normal browser window. `?session=<id>` opens that session;
// `?host=pip` adds "Back to Studio" (a message to the embedding window).
//
// [SAFETY] On a 401 it shows a sign-in message, on a 404/403 a "session
// unavailable" one, and in both the card is unmounted and the store stops
// polling (the store halts on a terminal answer). Nothing is retained.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../icon";
import { parseRoute } from "../../use-studio-route";
import { overlayAccess } from "../float-access";
import { tenantFromLocation } from "../session-registry";
import { useLiveSession } from "../use-live-session";
import { installHostSurface, isNativeSurface } from "./host-surface";
import { OverlayCard } from "./overlay-card";
import { sendIntent } from "./overlay-intents";
import { tellHost } from "./overlay-url";
import { parsePanel } from "./panels/panel-kinds";
import { PanelsRoot } from "./panels/panels-root";

// `?panel=pill|analysis|chat|settings` shows one focused panel of the same
// session; without it (or with an unknown value) this is the compact card.
export function OverlayPage() {
  const panel = parsePanel(window.location.search);
  return panel ? <PanelsRoot panel={panel} /> : <CardOverlayPage />;
}

function CardOverlayPage() {
  const { snapshot, actions } = useLiveSession();
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("session");
  const embedded = params.get("host") === "pip";
  const access = overlayAccess(snapshot, tenantFromLocation());
  const [missing, setMissing] = useState(false);
  const opened = useRef(false);

  useEffect(() => {
    document.title = "Interview Studio · Live overlay";
    return installHostSurface(isNativeSurface(params));
  }, []);
  // Open the requested session once the store has its first answer.
  useEffect(() => {
    if (!requested || opened.current || snapshot.hydration !== "ready") return;
    opened.current = true;
    if (snapshot.session?.id === requested) return;
    void actions.switchSession(requested).then((result) => {
      if (!result.ok) setMissing(true);
    });
  }, [requested, snapshot.hydration, snapshot.session?.id, actions]);
  // A window embedding this page closes it when access is lost.
  useEffect(() => {
    if (access !== "ok") tellHost("lost");
  }, [access]);

  if (access !== "ok")
    return (
      <div className="ov-root" data-testid="overlay-root" data-access={access}>
        <p className="ov-unavailable" role="alert">
          <Icon name={access === "signed-out" ? "lock" : "warning"} />
          {access === "signed-out"
            ? "You’re signed out. Sign in to Studio again to continue."
            : "This session is unavailable."}
        </p>
      </div>
    );

  return (
    <div className="ov-root" data-testid="overlay-root">
      {missing && snapshot.session && (
        <p className="ov-note ov-missing" role="alert">
          That session couldn’t be opened. Showing the session below instead.
        </p>
      )}
      {snapshot.session ? (
        <OverlayCard
          variant="overlay"
          {...(embedded ? { onLeave: () => tellHost("close") } : {})}
        />
      ) : (
        <div className="ov-empty" data-testid="overlay-empty">
          {snapshot.hydration !== "ready" ? (
            <p className="ov-muted" aria-busy="true">
              Loading…
            </p>
          ) : (
            <>
              <p className="ov-muted">
                {missing
                  ? "That session couldn’t be opened."
                  : "No live session."}
              </p>
              <button
                type="button"
                className="ov-link"
                onClick={() =>
                  sendIntent(parseRoute(window.location).base, {
                    type: "open-start",
                  })
                }
              >
                Start one in Studio
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
