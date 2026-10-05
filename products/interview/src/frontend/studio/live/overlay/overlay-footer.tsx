// Follow-up input and the footer: the honest "Visible window" note, Pause or
// Resume, and End (with its own confirmation). Each calls a store action.

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Icon } from "../../icon";
import type { SessionErrorCode } from "../session-client";
import { latestRefusalReason } from "../session-client";
import type { CommandResult, SessionActions } from "../session-snapshot";
import { BUILD_ID } from "./build-id";
import { FOCUS_INPUT_EVENT } from "./panels/commands";
import { type FooterButtonId, footerButtons } from "./panels/toolbar-config";

export const UNAVAILABLE_NOTE =
  "Not available yet: this Studio server can’t take owner input.";

// What each fixed refusal reason from the server means, in plain words.
const REFUSAL_REASONS: Record<string, string> = {
  fields: "the request had a missing or unexpected field",
  body: "the upload could not be read as a form",
  no_image: "no image came with the request",
  image_empty: "the image was empty",
  image_too_large: "the image was over the 2 MB limit",
  image_type: "the image was not a JPEG, PNG or WebP",
  image_unreadable: "the image header could not be read",
  image_dimensions: "the image dimensions were out of range",
  target: "the task to attach it to was not valid",
};

export const failureNote = (code: SessionErrorCode): string =>
  code === "unavailable"
    ? UNAVAILABLE_NOTE
    : code === "invalid_input"
      ? `The server refused that capture (invalid_input${(() => {
          const reason = latestRefusalReason();
          return reason ? `: ${REFUSAL_REASONS[reason] ?? reason}` : "";
        })()}). The session is unchanged; the next capture tries again.`
      : code === "status_refused"
        ? "The session is not taking captures now (status_refused). Resume it or start a new one."
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
  // "Add context" (the missing-context strip) takes the person here.
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => input.current?.focus();
    window.addEventListener(FOCUS_INPUT_EVENT, focus);
    return () => window.removeEventListener(FOCUS_INPUT_EVENT, focus);
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (shown.trim() === "") return;
    const result = await onSend(shown);
    if (result.ok) onChange("");
  }
  return (
    <form className="ov-followup" onSubmit={submit}>
      <input
        ref={input}
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
  sessionWording = false,
  ended = false,
  onStart,
  starting = false,
  clock,
  onOpenSummary,
}: {
  // The one-window view spells out what each button acts on: "End session".
  sessionWording?: boolean;
  // A finished session offers a new one instead of Pause and End.
  ended?: boolean;
  onStart?(): void;
  starting?: boolean;
  // The one-window view shows the session's running time beside a live dot
  // (amber while paused).
  clock?: { label: string; paused: boolean } | null;
  // A finished session offers its summary page.
  onOpenSummary?(): void;
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
  // What each button does; which ones show is decided by footerButtons().
  const press: Record<FooterButtonId, () => void> = {
    pause: () => void run(actions.pause()),
    resume: () => void run(actions.resume()),
    end: () => setConfirming(true),
    start: () => onStart?.(),
    summary: () => onOpenSummary?.(),
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
        <span className="ov-build" data-testid="ov-build" title="Build">
          {BUILD_ID}
        </span>
        {clock && (
          <span
            className="ov-clock"
            role="timer"
            aria-label={`Session time ${clock.label}${clock.paused ? ", paused" : ""}`}
            data-paused={clock.paused ? "true" : undefined}
            data-testid="ov-clock"
          >
            <span className="ov-clock-dot" aria-hidden="true" />
            {clock.label}
          </span>
        )}
        {footerButtons({
          paused,
          ended,
          starting,
          busy: pending.includes("pause") || pending.includes("resume"),
          wording: sessionWording ? "session" : "short",
          canStart: onStart !== undefined,
          canSummary: onOpenSummary !== undefined,
        }).map((button) => (
          <button
            key={button.id}
            ref={button.id === "end" ? endButton : undefined}
            type="button"
            className={
              button.tone === "default"
                ? "ov-button"
                : `ov-button ${button.tone}`
            }
            title={button.title}
            disabled={button.disabled}
            onClick={() => press[button.id]()}
          >
            {button.icon && <Icon name={button.icon} filled />}
            {button.label}
          </button>
        ))}
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
