// The minimized view: the bar, the chat and the session footer in ONE window the
// person can move and resize. Its right-edge handle (drawn by the shell) grows
// the window to the right, which reveals the analysis beside the chat; narrow,
// only the chat shows. The footer is the card's own: Pause or Resume, End (with
// its confirmation), the honest "Visible window" note and the build id.
import { failureNote, Footer } from "../overlay-footer";
import {
  AnalysisPanel,
  ChatPanel,
  type PanelSession,
  PillPanel,
} from "./panel-views";

export function SinglePanel({ s }: { s: PanelSession }) {
  return (
    <>
      <PillPanel s={s} />
      <div className="pn-single-body">
        <div className="pn-single-pane" data-which="chat">
          <ChatPanel s={s} />
        </div>
        <div className="pn-single-pane" data-which="analysis">
          <AnalysisPanel s={s} />
        </div>
      </div>
      <div className="pn-single-foot">
        <Footer
          paused={s.paused}
          pending={s.snapshot.pending}
          actions={s.actions}
          onFailure={(code) => s.notify(failureNote(code))}
        />
      </div>
    </>
  );
}
