// The Focus controls: Analyze latest capture, a typed follow-up, Copy, Open in
// Workspace, Pause or Resume, and End. Each calls a store action; none holds
// session logic. A server without the owner-input route answers "unavailable",
// which disables the two input controls with a clear note instead of failing.
import { type FormEvent, useState } from "react";
import { Icon } from "../icon";
import { EndConfirm } from "./end-confirm";
import type { FocusFacts } from "./focus-model";
import type { SessionErrorCode } from "./session-client";
import type { LiveSnapshot, SessionActions } from "./session-snapshot";
import type { SessionDraftLink } from "./workspace-handoff";

export const UNAVAILABLE_NOTE =
  "Not available yet: this Studio server can’t take owner input.";

const failure = (code: SessionErrorCode): string =>
  code === "unavailable"
    ? UNAVAILABLE_NOTE
    : `That didn’t work (${code}). The session is unchanged.`;

export type FocusControlsProps = {
  snapshot: LiveSnapshot;
  actions: SessionActions;
  facts: FocusFacts;
  paused: boolean;
  // The text Copy would copy (the answer or the code); null when none.
  copyable: string | null;
  onCopy(text: string): void;
  workspace: SessionDraftLink | null;
};

export function FocusControls({
  snapshot,
  actions,
  facts,
  paused,
  copyable,
  onCopy,
  workspace,
}: FocusControlsProps) {
  const [followUp, setFollowUp] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const pending = (command: string) =>
    snapshot.pending.some((item) => item === command);
  const analyzing = pending("analyze");
  const sending = pending("follow-up");

  async function settle(
    work: Promise<{ ok: true } | { ok: false; code: SessionErrorCode }>,
  ) {
    setNote(null);
    const result = await work;
    if (result.ok) return true;
    if (result.code === "unavailable") setUnavailable(true);
    setNote(failure(result.code));
    return false;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (followUp.trim() === "") return;
    if (await settle(actions.submitFollowUp(followUp))) setFollowUp("");
  }

  return (
    <div className="live-focus-controls" data-testid="focus-controls">
      <div className="live-focus-row">
        <button
          type="button"
          className="studio-button"
          disabled={!facts.capture || unavailable || analyzing}
          aria-busy={analyzing}
          onClick={() => void settle(actions.analyzeLatestCapture())}
        >
          <Icon name="sensors" />
          Analyze latest capture
          {facts.capture && (
            <span className="live-note">
              {facts.capture.sourceLabel} · {facts.capture.ageText}
            </span>
          )}
        </button>
        {!facts.capture && (
          <span className="live-note">No capture received yet.</span>
        )}
      </div>
      <form className="live-focus-row" onSubmit={submit}>
        <input
          className="live-focus-input"
          aria-label="Follow-up"
          placeholder="Type a follow-up"
          value={followUp}
          disabled={unavailable || sending}
          onChange={(event) => setFollowUp(event.target.value)}
        />
        <button
          type="submit"
          className="studio-button"
          disabled={unavailable || sending || followUp.trim() === ""}
        >
          Send follow-up
        </button>
      </form>
      {note && (
        <p className="live-note" role="alert">
          {note}
        </p>
      )}
      <div className="live-focus-row">
        <button
          type="button"
          className="studio-button"
          disabled={copyable === null}
          onClick={() => copyable !== null && onCopy(copyable)}
        >
          <Icon name="content_copy" />
          Copy
        </button>
        <button
          type="button"
          className="studio-button"
          disabled={!workspace}
          onClick={() => workspace?.open()}
        >
          <Icon name="terminal" />
          Open in Workspace
        </button>
        <button
          type="button"
          className="studio-button"
          disabled={pending("pause") || pending("resume")}
          onClick={() =>
            void settle(paused ? actions.resume() : actions.pause())
          }
        >
          <Icon name="pause_circle" />
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="studio-button danger"
          onClick={() => setConfirming(true)}
        >
          End
        </button>
      </div>
      {confirming && (
        <EndConfirm
          busy={pending("end")}
          onKeepGoing={() => setConfirming(false)}
          onEnd={async () => {
            if (!(await settle(actions.end()))) setConfirming(false);
          }}
        />
      )}
    </div>
  );
}
