import type { LiveSessionView } from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../icon";
import { speechState } from "./companion-capability";
import { EndConfirm } from "./end-confirm";
import { presentation, usePresentation } from "./focus-presentation";
import { studioHostInfo } from "./host-adapter";
import {
  commandMessage,
  companionLine,
  LOCALITY_ICON,
  PAUSE_CONTROL,
  PAUSED_TOAST,
  RESUMED_RENEWED_TOAST,
  RESUMED_TOAST,
  sourceChips,
  stateView,
} from "./session-bar-model";
import type { SessionErrorCode } from "./session-client";
import type { SessionCommand } from "./session-snapshot";
import { useCompanionCapability } from "./use-companion-capability";
import { useLiveSession } from "./use-live-session";
import { useSessionTarget } from "./use-session-target";

export type SessionBarProps = {
  // "bar": the strip above every Studio page while a session is open.
  // "header": the live header inside the Live session view itself.
  variant: "bar" | "header";
  // Return to the Live session view ("Open" in the bar).
  onOpen(): void;
};

const NOTICE_MS = 5_000;
const ERROR_MS = 10_000;
const SPEECH_REFRESH_MS = 30_000;

type Notice = { tone: "info" | "error"; text: string };

// The persistent session control: state, target, elapsed time, activity,
// source chips, locality, Pause/Resume and End. Renders nothing unless a
// session is open (created, active or paused). It reads the store itself, so
// it keeps working on every page and while the stream is failing: the owner's
// stop actions are never gated on the stream's health.
export function SessionBar(props: SessionBarProps) {
  const { snapshot, model } = useLiveSession();
  if (model.phase !== "open" || !snapshot.session) return null;
  return <OpenSessionBar {...props} session={snapshot.session} />;
}

function OpenSessionBar({
  variant,
  onOpen,
  session,
}: SessionBarProps & { session: LiveSessionView }) {
  const { snapshot, actions, model } = useLiveSession();
  const target = useSessionTarget(session);
  const { mode: presentationMode } = usePresentation();
  const [confirming, setConfirming] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const endButton = useRef<HTMLButtonElement>(null);
  const capability = useCompanionCapability(SPEECH_REFRESH_MS);
  const speech =
    capability.status === "ready" ? speechState(capability.capability) : null;

  // A notice clears itself; an error stays a little longer.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(
      () => setNotice(null),
      notice.tone === "error" ? ERROR_MS : NOTICE_MS,
    );
    return () => clearTimeout(timer);
  }, [notice]);

  const state = stateView(model);
  const chips = sourceChips(model);
  const pending = (...commands: SessionCommand[]) =>
    commands.some((command) => snapshot.pending.includes(command));
  const pauseBusy = resuming || pending("pause", "resume", "renew");
  const endBusy = pending("end");
  const paused = session.status === "paused";
  const pauseFace = paused ? PAUSE_CONTROL.resume : PAUSE_CONTROL.pause;
  const fail = (code: SessionErrorCode) =>
    setNotice({ tone: "error", text: commandMessage(code) });

  async function pause() {
    setNotice(null);
    const result = await actions.pause();
    if (result.ok) setNotice({ tone: "info", text: PAUSED_TOAST });
    else fail(result.code);
  }

  // The server refuses a resume on an expired or revoked credential with
  // credential_renewal_required: renew, then resume, as one action.
  async function resume() {
    setNotice(null);
    setResuming(true);
    try {
      let renewed = false;
      let result = await actions.resume();
      if (!result.ok && result.code === "credential_renewal_required") {
        const renewal = await actions.renewCredential();
        if (!renewal.ok) return fail(renewal.code);
        renewed = true;
        result = await actions.resume();
      }
      if (result.ok)
        setNotice({
          tone: "info",
          text: renewed ? RESUMED_RENEWED_TOAST : RESUMED_TOAST,
        });
      else fail(result.code);
    } finally {
      setResuming(false);
    }
  }

  function closeConfirm() {
    setConfirming(false);
    endButton.current?.focus();
  }

  async function end() {
    const result = await actions.end();
    // Ended: the bar goes away with the session, so only a failure needs the
    // popover closed and the reason shown.
    if (!result.ok) {
      closeConfirm();
      fail(result.code);
    }
  }

  // Only what adds to the state phrase: not "Idle", and never the same words twice.
  const showActivity =
    model.activity.text !== "" &&
    !["idle", "paused", "ended", "stream-unreachable"].includes(
      model.activity.key,
    ) &&
    model.activity.text.toLowerCase() !== state.label.toLowerCase();
  const companion = companionLine(model);

  return (
    <section
      className={`live-session-bar tone-${state.tone}${state.bordered ? " bordered" : ""}`}
      data-testid="session-bar"
      data-variant={variant}
      data-state={state.key}
      aria-label="Session control"
    >
      <div className="live-bar-main">
        <span className="live-bar-state">
          <span role="status" className="live-bar-status">
            <span
              className={`live-dot ${state.tone === "neutral" ? "" : state.tone}${state.pulse ? " pulse" : ""}`}
              aria-hidden="true"
            />
            <span className="live-bar-label">{state.label}</span>
          </span>
          <span
            className="live-bar-elapsed"
            title="Elapsed on the server clock"
          >
            {model.elapsedLabel}
          </span>
        </span>
        <span className="live-bar-target">{target}</span>
        {showActivity && (
          <span className="live-bar-activity">{model.activity.text}</span>
        )}
      </div>

      <ul className="live-bar-chips" aria-label="Capture sources">
        {chips.map((chip) => (
          <li
            key={chip.source}
            className={`live-chip ${chip.tone === "none" ? "" : chip.tone}`}
            title={chip.title}
            data-source={chip.source}
            data-reason={chip.reason ?? undefined}
            data-alert={chip.alert || undefined}
          >
            <Icon name={chip.icon} />
            <span className="live-chip-text">{chip.label}</span>
            <span className="live-sr-only">{`, ${chip.state}`}</span>
          </li>
        ))}
        {!companion.connected && (
          <li
            className="live-chip neutral"
            title={companion.title}
            data-testid="companion-chip"
            data-connected="false"
          >
            <Icon name="devices" />
            <span className="live-chip-text">{companion.text}</span>
          </li>
        )}
        {companion.connected && speech && (
          <li
            className={`live-chip ${speech.tone === "green" ? "" : speech.tone}`}
            title={`From the companion's last capability report. ${speech.detail}`}
            data-testid="speech-chip"
            data-speech={speech.key}
          >
            <Icon name="mic" />
            <span className="live-chip-text">{`Speech: ${speech.label}`}</span>
          </li>
        )}
        {model.locality && (
          <li
            className={`live-chip ${model.locality.tone}`}
            title={model.locality.meaning}
            data-testid="locality-chip"
            data-policy={model.locality.policy}
          >
            <Icon name={LOCALITY_ICON[model.locality.policy]} />
            <span className="live-chip-text">{model.locality.label}</span>
            <span className="live-sr-only">{`. ${model.locality.meaning}`}</span>
          </li>
        )}
      </ul>

      <div className="live-bar-actions" role="toolbar" aria-label="Session">
        {variant === "header" && (
          <button
            type="button"
            className="studio-button live-bar-button"
            title="Pop out the capture controls into a floating window"
            disabled={presentationMode === "floating"}
            onClick={() => presentation.setMode("floating")}
          >
            <Icon name="picture_in_picture_alt" />
            Pop out
          </button>
        )}
        {variant === "bar" && (
          <button
            type="button"
            className="studio-button live-bar-button"
            title="Open the live session"
            onClick={onOpen}
          >
            Open
          </button>
        )}
        {(paused || session.status === "active") && (
          <button
            type="button"
            className="studio-button live-bar-button"
            aria-busy={pauseBusy}
            disabled={pauseBusy}
            onClick={() => void (paused ? resume() : pause())}
          >
            <Icon name={pauseFace.icon} filled />
            {pauseFace.label}
          </button>
        )}
        <button
          ref={endButton}
          type="button"
          className="studio-button live-bar-button danger"
          aria-haspopup="dialog"
          aria-expanded={confirming}
          aria-busy={endBusy}
          disabled={endBusy}
          onClick={() => setConfirming(true)}
        >
          <Icon name="stop_circle" filled />
          End
        </button>
      </div>

      {confirming && (
        <EndConfirm
          busy={endBusy}
          inMacApp={studioHostInfo() !== null}
          onKeepGoing={closeConfirm}
          onEnd={() => void end()}
        />
      )}
      <div
        className={`live-bar-notice ${notice?.tone ?? ""}`}
        role={notice?.tone === "error" ? "alert" : "status"}
        aria-live={notice?.tone === "error" ? "assertive" : "polite"}
      >
        {notice?.text}
      </div>
    </section>
  );
}
