// Follow-up input and the footer: the honest "Visible window" note, Pause or
// Resume, and End (with its own confirmation). Each calls a store action.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Icon } from "../../icon";
import type { SessionErrorCode } from "../session-client";
import type { CommandResult, SessionActions } from "../session-snapshot";

export const UNAVAILABLE_NOTE =
  "Not available yet: this Studio server can’t take owner input.";

export const failureNote = (code: SessionErrorCode): string =>
  code === "unavailable"
    ? UNAVAILABLE_NOTE
    : `That didn’t work (${code}). The session is unchanged.`;

export function FollowUp({
  label,
  value,
  interim = "",
  onChange,
  disabled,
  sending,
  onSend,
}: {
  label: string;
  value: string;
  // Words dictation has heard but not yet settled: shown after the text, lighter,
  // and solid once final.
  interim?: string;
  onChange(text: string): void;
  disabled: boolean;
  sending: boolean;
  onSend(text: string): Promise<CommandResult>;
}) {
  const shown = interim
    ? `${value}${value === "" || value.endsWith(" ") ? "" : " "}${interim}`
    : value;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (shown.trim() === "") return;
    const result = await onSend(shown);
    if (result.ok) onChange("");
  }
  return (
    <form className="ov-followup" onSubmit={submit}>
      <input
        className={`ov-input${interim ? " interim" : ""}`}
        aria-label="Follow-up"
        placeholder={label}
        value={shown}
        data-interim={interim ? "true" : undefined}
        disabled={disabled || sending}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="submit"
        className="ov-send"
        aria-label="Send follow-up"
        disabled={disabled || sending || shown.trim() === ""}
      >
        <Icon name="arrow_upward" />
      </button>
    </form>
  );
}

export function Footer({
  paused,
  pending,
  actions,
  onFailure,
}: {
  paused: boolean;
  pending: readonly string[];
  actions: SessionActions;
  onFailure(code: SessionErrorCode): void;
}) {
  const [confirming, setConfirming] = useState(false);
  const endButton = useRef<HTMLButtonElement>(null);
  const keepGoing = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) keepGoing.current?.focus();
  }, [confirming]);
  const run = async (work: Promise<CommandResult>) => {
    const result = await work;
    if (!result.ok) onFailure(result.code);
    return result.ok;
  };
  return (
    <div className="ov-footer">
      <div className="ov-footer-row">
        <span
          className="ov-visible"
          title="This is a normal window. It appears in screen shares and recordings."
        >
          <Icon name="visibility" />
          Visible window · shows in screen shares
        </span>
        <button
          type="button"
          className="ov-button"
          disabled={pending.includes("pause") || pending.includes("resume")}
          onClick={() => void run(paused ? actions.resume() : actions.pause())}
        >
          <Icon name={paused ? "play_arrow" : "pause"} filled />
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          ref={endButton}
          type="button"
          className="ov-button danger"
          onClick={() => setConfirming(true)}
        >
          End
        </button>
      </div>
      {confirming && (
        <div
          className="ov-confirm"
          role="alertdialog"
          aria-label="End this session?"
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
            event.stopPropagation();
            setConfirming(false);
            endButton.current?.focus();
          }}
        >
          <span>
            End this session? Capture stops and running work is cancelled.
          </span>
          <button
            ref={keepGoing}
            type="button"
            className="ov-button"
            onClick={() => {
              setConfirming(false);
              endButton.current?.focus();
            }}
          >
            Keep going
          </button>
          <button
            type="button"
            className="ov-button danger"
            disabled={pending.includes("end")}
            onClick={async () => {
              if (!(await run(actions.end()))) setConfirming(false);
            }}
          >
            End now
          </button>
        </div>
      )}
    </div>
  );
}
