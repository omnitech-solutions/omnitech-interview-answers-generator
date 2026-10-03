import type { StudioActions } from "../config/commands";

export type SetupViewProps = {
  // Studio navigation, for the briefing and Rehearsal links.
  studio: StudioActions;
};

// "Start a live session": target, consent, sources, assistance, locality and
// retention. Starting goes through `useLiveSession().actions.start`; once the
// store holds an open session the Live view switches to the live panel by
// itself.
//
// STUB (plan #3 U3): the setup unit replaces this body and keeps these props
// and the test id.
export function SetupView(_props: SetupViewProps) {
  return (
    <div className="live-page" data-testid="live-setup">
      <h2>Start a live session</h2>
    </div>
  );
}
