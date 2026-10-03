import type { StudioActions } from "../config/commands";
import { SessionBar } from "./session-bar";

export type LiveSessionPanelProps = {
  // Studio navigation, for opening the session draft in the Workspace.
  studio: StudioActions;
};

// A session that is open (created, active or paused): the live header, the
// banners, the task panels and the Transcript, Activity and Sources tabs.
// Everything comes from `useLiveSession()`.
//
// STUB (plan #3 U3): the live view unit replaces this body and keeps these
// props and the test id.
export function LiveSessionPanel(_props: LiveSessionPanelProps) {
  return (
    <div className="live-page" data-testid="live-panel">
      <SessionBar variant="header" onOpen={() => undefined} />
    </div>
  );
}
