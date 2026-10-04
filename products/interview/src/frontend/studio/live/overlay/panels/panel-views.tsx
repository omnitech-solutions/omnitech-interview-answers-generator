// The four panels, as the OpenCluely recording shows them and nothing more:
// the bar, the analysis (text column plus a separate code card), the live
// transcription and chat, and settings. Each takes the one panel session
// (usePanelSession) and renders it; none fetches or decides anything itself.
//
// [SAFETY] The settings footer says plainly that this is a visible window that
// shows in screen shares. Nothing here hides a window or conceals capture.
import {
  LIVE_OWNER_SKILL_LABELS,
  LIVE_OWNER_SKILLS,
  type LiveOwnerSkill,
  type PresentationHost,
} from "@omnitech/interview-contracts";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Icon } from "../../../icon";
import { BUILD_ID } from "../build-id";
import type { ApproachItem } from "../overlay-model";
import { CodeCard, TextCard } from "./code-card";
import { DEFAULT_SKILL } from "./commands";
import {
  languageOptions,
  NOT_SUPPORTED_YET,
  supportedLanguage,
} from "./languages";
import { analysisView, clock, type PanelRow, panelRows } from "./panel-model";
import { quitShell } from "./shell-bridge";
import type { usePanelSession } from "./use-panel-session";

export type PanelSession = ReturnType<typeof usePanelSession>;
type Tone = "green" | "red" | "neutral";

// The hotkey the bar shows for the capture (the shell registers it).
export const CAPTURE_HINT = "⌘⇧S";
export const CHAT_PLACEHOLDER = "Type a message or transcription…";

// green: interaction on. red: interaction off, or recording.
export function pillTone(s: PanelSession): { tone: Tone; label: string } {
  if (!s.open) return { tone: "neutral", label: "Ended" };
  if (s.live.mic === "listening") return { tone: "red", label: "Recording" };
  if (s.interaction === false) return { tone: "red", label: "Interaction off" };
  return { tone: "green", label: "Interaction on" };
}

// The short names the bar uses; every other skill shows its full name.
const BAR_NAME: Partial<Record<LiveOwnerSkill, string>> = {
  dsa: "DSA",
  behavioral: "Behavioral",
};
export const skillName = (skill: LiveOwnerSkill | undefined): string => {
  const chosen = skill ?? DEFAULT_SKILL;
  return BAR_NAME[chosen] ?? LIVE_OWNER_SKILL_LABELS[chosen];
};

// ---- Bar --------------------------------------------------------------------

export function PillPanel({
  s,
  children,
}: {
  s: PanelSession;
  // Extra controls the one-window view adds after the status dot.
  children?: ReactNode;
}) {
  const status = pillTone(s);
  const recording = s.live.mic === "listening";
  return (
    <div
      className="pn-pill"
      role="toolbar"
      aria-label="Session controls"
      data-testid="pn-pill"
    >
      <button
        type="button"
        className="pn-bar-button"
        aria-label="Capture screenshot"
        title="Capture and analyze the screen"
        disabled={!s.open}
        onClick={() => s.press("capture")}
      >
        <Icon name="screenshot_monitor" />
        <kbd>{CAPTURE_HINT}</kbd>
      </button>
      <button
        type="button"
        className="pn-bar-button"
        aria-label={recording ? "Stop microphone" : "Start microphone"}
        aria-pressed={recording}
        data-mic={s.live.mic}
        disabled={!s.open}
        onClick={() => s.press("toggle-mic")}
      >
        <Icon name={recording ? "mic" : "mic_off"} filled={recording} />
      </button>
      <span className="pn-skill" data-testid="pn-skill">
        {skillName(s.skill)}
      </span>
      <span
        className="pn-dot"
        data-tone={status.tone}
        role="status"
        aria-label={status.label}
        title={status.label}
        data-testid="pn-dot"
      />
      {children}
    </div>
  );
}

// Whole seconds since `active` last turned on; 0 while it is off.
export function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return setSeconds(0);
    const started = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [active]);
  return seconds;
}

// ---- Analysis ---------------------------------------------------------------

const Lines = ({ lines }: { lines: readonly string[] }) => (
  <>
    {lines.map((line) => (
      <p key={line}>{line}</p>
    ))}
  </>
);

export function AnalysisPanel({
  s,
  part = "all",
}: {
  s: PanelSession;
  // The one window shows the text and the code as separate panes.
  part?: "all" | "text" | "code";
}) {
  const task = s.selected;
  const view = task ? analysisView(task) : null;
  // The one error line can be dismissed; a different message shows again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const note = s.note && s.note !== dismissed ? s.note : null;
  const waited = useElapsed(Boolean(s.phase));
  return (
    <div className="pn-analysis" data-testid="pn-analysis">
      {part !== "code" && (
        <div className="pn-card pn-analysis-text">
          {s.phase ? (
            <p
              className="pn-analyzing"
              role="status"
              data-testid="pn-analyzing"
            >
              Analyzing
              <span className="pn-ellipsis" aria-hidden="true">
                <i />
                <i />
              </span>
              {waited >= 3 && <span className="pn-muted"> {waited}s</span>}
            </p>
          ) : !view ? (
            <p className="pn-muted pn-centered" data-testid="pn-analysis-empty">
              Press {CAPTURE_HINT} to analyze the screen
            </p>
          ) : (
            <div className="pn-scroll" data-testid="pn-answer">
              <h2 className="pn-problem" data-testid="pn-problem">
                {view.title}
              </h2>
              <p>
                <strong>Problem Type:</strong>{" "}
                <span data-testid="pn-type">{view.problemType}</span>
              </p>
              {view.constraints.length > 0 && (
                <div className="pn-constraints">
                  <strong>Constraints:</strong>
                  <div className="pn-chips" aria-label="Constraints">
                    {view.constraints.map((text) => (
                      <span key={text} className="pn-chip">
                        {text}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(view.input.length > 0 || view.output.length > 0) && (
                <div>
                  <strong>Input/Output:</strong>
                  {view.input.length > 0 && (
                    <p>
                      <b>Input:</b> {view.input.join(" ")}
                    </p>
                  )}
                  {view.output.length > 0 && (
                    <p>
                      <b>Output:</b> {view.output.join(" ")}
                    </p>
                  )}
                </div>
              )}
              {view.steps.map((step) => (
                <div key={step.heading}>
                  <strong>{step.heading}</strong>
                  <Lines lines={step.lines} />
                </div>
              ))}
              {view.complexity.length > 0 && (
                <div>
                  <strong>Complexity</strong>
                  <Lines lines={view.complexity} />
                </div>
              )}
            </div>
          )}
          {note && (
            <p className="pn-note" role="alert">
              <span>{note}</span>
              <button
                type="button"
                className="pn-note-close"
                aria-label="Dismiss message"
                onClick={() => setDismissed(note)}
              >
                <Icon name="close" />
              </button>
            </p>
          )}
        </div>
      )}
      {part === "code" &&
        !(!s.phase && view && (view.example || view.code)) && (
          <div className="pn-card">
            <p className="pn-muted pn-centered">
              {s.phase ? "Code appears here when it is ready" : "No code yet"}
            </p>
          </div>
        )}
      {part !== "text" && !s.phase && view && (view.example || view.code) && (
        <div className="pn-codecol">
          {view.example && <TextCard text={view.example} />}
          {view.code && (
            <CodeCard language={view.code.language} text={view.code.text} />
          )}
        </div>
      )}
    </div>
  );
}

// ---- Chat / transcription ---------------------------------------------------

// **bold** inside a line; the text itself is inert (never HTML).
function Inline({ text }: { text: string }) {
  return (
    <>
      {text
        .split("**")
        .map((part, at) =>
          at % 2 === 1 ? <strong key={at}>{part}</strong> : part,
        )}
    </>
  );
}

const HEADING = /^(?:phase\s+\d+\b.*|[^:]{2,60}:)$/i;

// The assistant's formatted answer: headings in bold, lines as bullets, fenced
// blocks as code.
function AnswerText({ items }: { items: readonly ApproachItem[] }) {
  return (
    <div className="pn-answer">
      {items.map((item, at) =>
        item.kind === "code" ? (
          <pre key={at}>{item.text}</pre>
        ) : HEADING.test(item.text) ? (
          <p key={at} className="pn-answer-head">
            <Inline text={item.text} />
          </p>
        ) : (
          <p key={at} className="pn-answer-line">
            <Inline text={item.text} />
          </p>
        ),
      )}
    </div>
  );
}

function Row({ row }: { row: PanelRow }) {
  return (
    <div className="pn-row" data-kind={row.kind}>
      <span className="pn-time">{clock(row.at)}</span>
      {row.kind === "assistant" && row.items ? (
        <AnswerText items={row.items} />
      ) : (
        <span className="pn-text">{row.text}</span>
      )}
    </div>
  );
}

export function ChatPanel({ s }: { s: PanelSession }) {
  const rows = panelRows(s.model, s.entries, s.system, s.clearedAt);
  const recording = s.live.mic === "listening";
  // Shown whenever a capture or analysis is running, even right after an earlier
  // answer, so the transcript always says that something is happening.
  const loading = Boolean(s.phase);
  const waited = useElapsed(loading);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = s.draft.trim();
    if (text === "") return;
    const result = await s.send(text);
    if (result.ok) s.setDraft("");
  };
  return (
    <div className="pn-card pn-chat" data-testid="pn-chat">
      <header className="pn-head">
        <span className="pn-title">Live Transcription &amp; Chat</span>
        {recording && (
          <span
            className="pn-dot"
            data-tone="red"
            role="status"
            aria-label="Recording"
            data-testid="pn-rec"
          />
        )}
      </header>
      <div className="pn-log" role="log" aria-label="Transcript and chat">
        {rows.map((row) => (
          <Row key={row.key} row={row} />
        ))}
        {loading && (
          <div
            className="pn-row"
            data-kind="assistant"
            data-testid="pn-loading"
          >
            <span className="pn-time">{clock(Date.now())}</span>
            <span className="pn-text">
              {s.phase === "capturing" ? "Capturing the screen…" : "Analyzing…"}
              {waited >= 3 && ` ${waited}s`}
            </span>
          </div>
        )}
      </div>
      {s.live.interim !== "" && (
        <p className="pn-interim" data-testid="pn-interim">
          <em>{s.live.interim}</em>
        </p>
      )}
      {s.note && (
        <p className="pn-note" role="alert">
          <span>{s.note}</span>
        </p>
      )}
      <form className="pn-compose" onSubmit={submit}>
        <input
          className="pn-input"
          aria-label="Message"
          placeholder={CHAT_PLACEHOLDER}
          value={s.draft}
          disabled={!s.open}
          onChange={(event) => s.setDraft(event.target.value)}
        />
        <button
          type="button"
          className="pn-round pn-mic"
          aria-label={recording ? "Stop microphone" : "Start microphone"}
          aria-pressed={recording}
          disabled={!s.open}
          onClick={() => s.press("toggle-mic")}
        >
          <Icon name="mic" filled={recording} />
        </button>
        <button
          type="submit"
          className="pn-round pn-send"
          aria-label="Send message"
          disabled={!s.open || s.draft.trim() === ""}
        >
          <Icon name="arrow_upward" />
        </button>
      </form>
    </div>
  );
}

// ---- Settings ---------------------------------------------------------------

export function SettingsPanel({
  s,
  presentation,
}: {
  s: PanelSession;
  presentation: PresentationHost;
}) {
  const settings = s.prefs.settings;
  const close = async () => {
    if (!(await presentation.close("settings"))) window.close();
  };
  return (
    <div className="pn-card pn-settings" data-testid="pn-settings">
      <header className="pn-head">
        <span className="pn-title">Settings</span>
        <button
          type="button"
          className="pn-danger"
          data-testid="pn-quit"
          onClick={quitShell}
        >
          Quit
        </button>
        <button
          type="button"
          className="pn-danger"
          data-testid="pn-close"
          onClick={() => void close()}
        >
          Close
        </button>
      </header>
      <div className="pn-body">
        <div className="pn-label">Language &amp; Skills</div>
        <label className="pn-field">
          <span>Coding Language</span>
          <select
            className="pn-select"
            data-testid="pn-language-select"
            value={settings.language ?? ""}
            onChange={(event) =>
              s.prefs.setSettings({
                ...settings,
                language: supportedLanguage(event.target.value),
              })
            }
          >
            <option value="">Auto-detect</option>
            {languageOptions().map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={!option.supported}
              >
                {option.supported
                  ? option.label
                  : `${option.label} (${NOT_SUPPORTED_YET})`}
              </option>
            ))}
          </select>
        </label>
        <label className="pn-field">
          <span>Active Skill</span>
          <select
            className="pn-select"
            data-testid="pn-skill-select"
            value={s.skill}
            onChange={(event) => {
              const skill = LIVE_OWNER_SKILLS.find(
                (value) => value === event.target.value,
              );
              if (skill) s.prefs.setSettings({ ...settings, skill });
            }}
          >
            {LIVE_OWNER_SKILLS.map((value) => (
              <option key={value} value={value}>
                {LIVE_OWNER_SKILL_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <p className="pn-footer">
          Visible window · shows in screen shares ·{" "}
          <span data-testid="pn-build">Build {BUILD_ID}</span>
        </p>
      </div>
    </div>
  );
}

// ---- Toasts -----------------------------------------------------------------

// Bottom-left, large white text over a dark fade, gone after about 3 s. The
// shell may draw these itself (presentation.nativeToasts); then the page does
// not (panels-root decides).
export function Toasts({ s }: { s: PanelSession }) {
  if (s.toasts.length === 0) return null;
  return (
    <div
      className="pn-toasts"
      role="status"
      aria-live="polite"
      data-testid="pn-toasts"
    >
      {s.toasts.map((toast) => (
        <div key={toast.key} className="pn-toast">
          <div className="pn-toast-title">{toast.title}</div>
          <div className="pn-toast-detail">{toast.detail}</div>
        </div>
      ))}
    </div>
  );
}
