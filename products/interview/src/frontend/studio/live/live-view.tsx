import { useEffect } from "react";
import type { StudioActions } from "../config/commands";
import { EndedView } from "./ended-view";
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
export function LiveSessionView({ rest, studio }: LiveSessionViewProps) {
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
        <button
          type="button"
          className="studio-button"
          onClick={() => void actions.refresh()}
        >
          Try again
        </button>
      </div>
    ) : (
      <div className="live-page" data-testid="live-loading" aria-busy="true" />
    );
  }
  if (model.phase === "open") return <LiveSessionPanel studio={studio} />;
  if (model.phase === "finished") return <EndedView studio={studio} />;
  return <SetupView studio={studio} />;
}
