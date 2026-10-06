// Follow-up input and the footer: Pause or
// Resume, and End (with its own confirmation). Each calls a store action.

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "../../icon";
import type { SessionErrorCode } from "../session-client";
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

// `reason` is the refused request's own (CommandResult.reason), never a global.
export const failureNote = (
  code: SessionErrorCode,
  reason?: string | null,
): string =>
  code === "unavailable"
    ? UNAVAILABLE_NOTE
    : code === "invalid_input"
      ? `The server refused that capture (invalid_input${
          reason ? `: ${REFUSAL_REASONS[reason] ?? reason}` : ""
        }). The session is unchanged; the next capture tries again.`
      : code === "status_refused"
        ? "The session is not taking captures now (status_refused). Resume it or start a new one."
        : `That didn’t work (${code}). The session is unchanged.`;

export function FollowUp({
  label,
  value,
  interim = "",
  onChange,
  disabled,
  onSend,
}: {
  label: string;
  value: string;
  // Words dictation has heard but not yet settled: shown after the text, lighter,
  // and solid once final.
  interim?: string;
  onChange(text: string): void;
  disabled: boolean;
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
  // What the box holds now, so a send that finishes later clears only the
  // text it sent, never words typed while it was in flight.
  const latest = useRef(shown);
  latest.current = shown;
  async function submit(event: FormEvent) {
    event.preventDefault();
    const sent = shown;
    if (sent.trim() === "") return;
    const result = await onSend(sent);
    if (result.ok && latest.current.trim() === sent.trim()) onChange("");
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
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="submit"
        className="ov-send"
        aria-label="Send follow-up"
        disabled={disabled || shown.trim() === ""}
      >
        <Icon name="arrow_upward" />
      </button>
    </form>
  );
}

// What the footer is for. A live session may show its running time beside a
// live dot (amber while paused); a finished session offers a new one (and its
// summary page) instead of Pause and End.
export type FooterVariant =
  | {
      kind: "live";
      paused: boolean;
      clock?: { label: string; paused: boolean } | null;
    }
  | {
      kind: "ended";
      starting: boolean;
      onStart(): void;
      onOpenSummary?(): void;
    }
  // No session yet (signed out, or signed in and not started): the same bar with
  // no session buttons, and who is signed in at its right end.
  | { kind: "idle"; status: ReactNode };

export function Footer({
  variant,
  // The one-window view spells out what each button acts on: "End session".
  wording = "short",
  pending,
  actions,
  onFailure,
}: {
  variant: FooterVariant;
  wording?: "short" | "session";
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
    start: () => variant.kind === "ended" && variant.onStart(),
    summary: () => variant.kind === "ended" && variant.onOpenSummary?.(),
  };
  const clock = variant.kind === "live" ? variant.clock : null;
  const buttons =
    variant.kind === "idle"
      ? []
      : footerButtons(
          variant.kind === "ended"
            ? {
                kind: "ended",
                starting: variant.starting,
                canSummary: variant.onOpenSummary !== undefined,
              }
            : {
                kind: "live",
                paused: variant.paused,
                busy: pending.includes("pause") || pending.includes("resume"),
              },
          wording,
        );
  return (
    <div className="ov-footer">
      <div className="ov-footer-row">
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
        {variant.kind === "idle" && (
          <span className="ov-status" data-testid="ov-status">
            {variant.status}
          </span>
        )}
        {buttons.map((button) => (
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
              await run(actions.end());
              // Answered either way: on success the ended card takes over, on
              // failure the note says so and the dialog does not linger.
              setConfirming(false);
            }}
          >
            End now
          </button>
        </div>
      )}
    </div>
  );
}
