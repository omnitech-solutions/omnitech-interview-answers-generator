import { useEffect, useId, useRef } from "react";
import { END_BODY, END_HOST_LINE, END_TITLE } from "./session-bar-model";

export type EndConfirmProps = {
  // True while the End command is in flight.
  busy: boolean;
  // The page runs in the Mac app's window, so ending here ends it there too.
  inMacApp?: boolean;
  onKeepGoing(): void;
  onEnd(): void;
};

// The End confirmation: an alertdialog under the bar. Focus moves in on open
// (to the safe choice), Tab stays inside, Escape or a click outside keeps the
// session going, and the scrim stops a click from reaching the page beneath.
// The caller returns focus to the End button when this closes.
export function EndConfirm({
  busy,
  inMacApp = false,
  onKeepGoing,
  onEnd,
}: EndConfirmProps) {
  const titleId = useId();
  const bodyId = useId();
  const keepRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);
  useEffect(() => keepRef.current?.focus(), []);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onKeepGoing();
      return;
    }
    if (event.key !== "Tab") return;
    // Two controls: wrap at both ends.
    const first = keepRef.current;
    const last = endRef.current;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <>
      <div
        className="live-end-scrim"
        data-testid="end-scrim"
        onClick={onKeepGoing}
        aria-hidden="true"
      />
      <div
        className="live-end-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
      >
        <div id={titleId} className="live-end-title">
          {END_TITLE}
        </div>
        <div id={bodyId} className="live-end-body">
          {inMacApp ? `${END_BODY} ${END_HOST_LINE}` : END_BODY}
        </div>
        <div className="live-end-actions">
          <button
            ref={keepRef}
            type="button"
            className="studio-button live-bar-button"
            onClick={onKeepGoing}
          >
            Keep going
          </button>
          <button
            ref={endRef}
            type="button"
            className="studio-button live-bar-button danger"
            aria-busy={busy}
            disabled={busy}
            onClick={onEnd}
          >
            End session
          </button>
        </div>
      </div>
    </>
  );
}
