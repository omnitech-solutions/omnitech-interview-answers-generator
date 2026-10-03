import type { StudioActions } from "../config/commands";

export type LiveSessionViewProps = {
  // The path after `live`: a finished session's id addresses its summary.
  rest: readonly string[];
  actions: StudioActions;
};

// The Live session view: setup, the live session and the ended summary are
// states of one view, chosen from the session store (live/session-store.ts).
export function LiveSessionView(_props: LiveSessionViewProps) {
  return <div data-testid="live-view" />;
}
