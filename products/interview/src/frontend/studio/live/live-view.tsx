import { Button } from "@oc-tech/omni-ui-components";
import { useEffect } from "react";
import type { StudioActions } from "../config/commands";
import { EndedView, SessionNotFound } from "./ended-view";
import { LiveSessionPanel } from "./live-session-view";
import { SetupView } from "./setup-view";
import { useLiveSession } from "./use-live-session";

export type LiveSessionViewProps = {
  // The path after `live`: a finished session's id addresses its summary.
  rest: readonly string[];
  studio: StudioActions;
};

// The Live session view: setup, the live session and the ended summary are
// states of one view, chosen from the session store, not from this component's
// own state, so leaving and coming back lands on the same screen.
export function LiveSessionView(props: LiveSessionViewProps) {
  // The float host lives in the Studio shell (studio.tsx), not here, so the
  // floating window persists across pages.
  return <LiveSessionState {...props} />;
}

function LiveSessionState({ rest, studio }: LiveSessionViewProps) {
  const { snapshot, actions, model } = useLiveSession();
  const requested = rest[0];

  // An address (live/<id>) names a finished session to read. An open session
  // is never displaced, and an unknown id falls through to setup.
  useEffect(() => {
    if (requested) void actions.openSession(requested);
  }, [requested, actions]);
  // Arriving here re-reads the current session, so a session started or ended
  // elsewhere (another tab, the companion's own Stop) shows up.
  useEffect(() => {
    if (snapshot.hydration === "ready" && !requested) void actions.refresh();
    // On arrival only.
  }, []);

  if (!snapshot.session && snapshot.hydration !== "ready") {
    return snapshot.hydration === "failed" ? (
      <div className="live-page" data-testid="live-unavailable" role="alert">
        <p className="live-note">
          Studio couldn’t reach the session service. It will keep trying.
        </p>
        <Button
          variant="outline"
          buttonSize="lg"
          onClick={() => void actions.refresh()}
        >
          Try again
        </Button>
      </div>
    ) : (
      <div className="live-page" data-testid="live-loading" aria-busy="true" />
    );
  }
  // The address names a session the server does not know.
  if (requested && snapshot.notFoundSessionId === requested)
    return <SessionNotFound studio={studio} />;
  // The dashboard (or the ended summary, or setup) is the page; the card is the
  // shell's (live/card-host.tsx), so it stays when the person changes page.
  if (model.phase === "open") return <LiveSessionPanel />;
  if (model.phase === "finished") return <EndedView studio={studio} />;
  return <SetupView studio={studio} />;
}
