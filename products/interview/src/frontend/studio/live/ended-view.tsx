import type { StudioActions } from "../config/commands";
import { useLiveSession } from "./use-live-session";

export type EndedViewProps = {
  // Studio navigation, for opening the session draft and the Live view.
  studio: StudioActions;
};

// A finished session (ended, or being deleted): stats, results, retention and
// "Delete session data". "Start another session" calls `dismissFinished` and
// goes back to the Live view without an address.
//
// STUB (plan #3 U3): the ended view unit replaces this body and keeps these
// props and the test id.
export function EndedView({ studio }: EndedViewProps) {
  const { actions } = useLiveSession();
  return (
    <div className="live-page" data-testid="live-ended">
      <h2>Session ended</h2>
      <button
        type="button"
        className="studio-button"
        onClick={() => {
          actions.dismissFinished();
          studio.go("live");
        }}
      >
        Start another session
      </button>
    </div>
  );
}
