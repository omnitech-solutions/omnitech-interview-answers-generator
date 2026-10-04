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
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "../../../icon";
import { BUILD_ID } from "../build-id";
import type { ApproachItem } from "../overlay-model";
import { CodeCard, TextCard } from "./code-card";
import { useFollowLatest } from "./follow-latest";
import { DEFAULT_SKILL } from "./commands";
import {
  languageOptions,
  NOT_SUPPORTED_YET,
  supportedLanguage,
} from "./languages";
import {
  analysisView,
  clock,
  type PanelRow,
  panelRows,
  type TaskStage,
} from "./panel-model";
import { quitShell } from "./shell-bridge";
import {
  ATTACH_ACTION,
  CAPTURE_MODES,
  type CaptureMode,
  MISSING_CONTEXT_LABEL,
  captureControl,
  phaseLabel,
} from "./toolbar-config";
import type { usePanelSession } from "./use-panel-session";

export type PanelSession = ReturnType<typeof usePanelSession>;
type Tone = "green" | "red" | "neutral";

// The hotkey the bar shows for the capture (the shell registers it).
// The analysis asks the chat box to take focus (same document).
export const FOCUS_INPUT_EVENT = "pn-focus-input";
export const CAPTURE_HINT = "⌘⇧S";
export const CHAT_PLACEHOLDER = "Type a message or transcription…";
// Once there is a problem on screen, typed text is context for it.
export const CONTEXT_PLACEHOLDER =
  "Add context for this problem, or ask a follow-up…";

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
  captureMode,
}: {
  s: PanelSession;
  // The one window offers Auto or Manual beside the capture button.
  captureMode?: {
    value: CaptureMode;
    onChange(mode: CaptureMode): void;
  };
  // Extra controls the one-window view adds after the status dot.
  children?: ReactNode;
}) {
  const status = pillTone(s);
  const recording = s.live.mic === "listening";
  const control = captureControl(Boolean(s.phase));
  return (
    <div
      className="pn-pill"
      role="toolbar"
      aria-label="Session controls"
      data-testid="pn-pill"
    >
      <div className="pn-split" data-stop={control.stop ? "true" : undefined}>
        <button
          type="button"
          className="pn-split-main"
          aria-label={control.label}
          title={control.title}
          disabled={!s.open}
          onClick={() => s.press("capture")}
        >
          <span className="pn-icon-dot">
            <Icon name="screenshot_monitor" />
            <span
              className="pn-dot"
              data-tone={status.tone}
              role="status"
              aria-label={status.label}
              title={status.label}
              data-testid="pn-dot"
            />
          </span>
          <kbd>{CAPTURE_HINT}</kbd>
        </button>
        {captureMode && (
          <label
            className="pn-split-menu"
            title={
              CAPTURE_MODES.find((mode) => mode.id === captureMode.value)?.title
            }
          >
            <span>
              {
                CAPTURE_MODES.find((mode) => mode.id === captureMode.value)
                  ?.label
              }
            </span>
            <Icon name="expand_more" />
            <select
              aria-label="Capture mode"
              value={captureMode.value}
              onChange={(event) => {
                // The attach entry is an action: do it, and the menu keeps showing
                // the mode that is still chosen.
                if (event.target.value === ATTACH_ACTION.id) {
                  s.press("attach");
                  return;
                }
                captureMode.onChange(
                  CAPTURE_MODES.find((mode) => mode.id === event.target.value)
                    ?.id ?? captureMode.value,
                );
              }}
            >
              {CAPTURE_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
              <option
                value={ATTACH_ACTION.id}
                title={ATTACH_ACTION.title}
                disabled={!s.selected || !s.open}
              >
                {ATTACH_ACTION.label}
              </option>
            </select>
          </label>
        )}
      </div>
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
              {phaseLabel(s.phase, s.model.activity.key)}
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
              <div className="pn-problem-head">
                <h2 className="pn-problem" data-testid="pn-problem">
                  {view.title}
                </h2>
                <span className="pn-type-pill" data-testid="pn-type">
                  {view.problemType}
                </span>
              </div>
              {s.missing && (
                <div
                  className="pn-missing"
                  role="note"
                  data-testid="pn-missing"
                >
                  <strong>The AI may be missing:</strong>
                  <ul>
                    {s.missing.map((item) => (
                      <li key={item.kind}>
                        {MISSING_CONTEXT_LABEL[item.kind] ?? item.kind}
                        {item.note ? `: ${item.note}` : ""}
                      </li>
                    ))}
                  </ul>
                  <div className="pn-missing-actions">
                    <button
                      type="button"
                      className="pn-bar-button"
                      onClick={() => s.press("attach")}
                    >
                      Add another screenshot
                    </button>
                    <button
                      type="button"
                      className="pn-bar-button"
                      onClick={() =>
                        window.dispatchEvent(new Event(FOCUS_INPUT_EVENT))
                      }
                    >
                      Add context
                    </button>
                    <button
                      type="button"
                      className="pn-bar-button"
                      onClick={s.dismissMissing}
                    >
                      Looks complete
                    </button>
                  </div>
                </div>
              )}
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

// A task's current stage, with the time it has taken. It sits in the task's own
// row, so the row reads "Solutioning… 12s" and then the answer takes its place.
function Stage({ stage, label }: { stage: TaskStage; label?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - stage.since) / 1000));
  return (
    <span className="pn-stage" role="status" data-testid="pn-stage">
      {label ?? stage.label}…{seconds >= 3 ? ` ${seconds}s` : ""}
    </span>
  );
}

function Row({
  row,
  selected,
  onSelect,
}: {
  row: PanelRow;
  selected: boolean;
  onSelect(taskId: string): void;
}) {
  const taskId = row.taskId;
  // An answer can be chosen to bring its task into the analysis and code panes.
  const choose =
    taskId === undefined
      ? {}
      : {
          role: "button" as const,
          tabIndex: 0,
          "aria-pressed": selected,
          title: "Show this answer",
          onClick: () => onSelect(taskId),
          onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(taskId);
            }
          },
        };
  return (
    <div
      className="pn-row"
      data-kind={row.kind}
      data-selected={selected ? "true" : undefined}
      {...choose}
    >
      <span className="pn-time">{clock(row.at)}</span>
      {row.kind === "assistant" && row.items ? (
        <AnswerText items={row.items} />
      ) : row.stage ? null : (
        <span className="pn-text">{row.text}</span>
      )}
      {row.stage && <Stage stage={row.stage} />}
    </div>
  );
}

export function ChatPanel({ s }: { s: PanelSession }) {
  const rows = panelRows(s.model, s.entries, s.system, s.clearedAt);
  const recording = s.live.mic === "listening";
  // A task's own row shows its stage. This pending row covers the moment before
  // a task exists (capturing the screen, a new utterance being read).
  const staged = rows.some((row) => row.stage !== undefined);
  const loading = Boolean(s.phase) && !staged;
  const waited = useElapsed(loading);
  // The log follows the newest line until the person scrolls up; then a button
  // counts what they have missed and takes them back.
  const last = rows[rows.length - 1];
  const log = useFollowLatest(
    rows.length,
    `${loading}-${last?.stage?.label}-${last?.items?.length ?? 0}`,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener(FOCUS_INPUT_EVENT, focus);
    return () => window.removeEventListener(FOCUS_INPUT_EVENT, focus);
  }, []);
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
      <div
        className="pn-log"
        role="log"
        aria-label="Transcript and chat"
        ref={log.ref}
        onScroll={log.onScroll}
        onWheel={log.onPersonScroll}
        onTouchMove={log.onPersonScroll}
        onPointerDown={log.onPersonScroll}
        onKeyDown={log.onPersonScroll}
      >
        {rows.map((row) => (
          <Row
            key={row.key}
            row={row}
            selected={
              row.taskId !== undefined && row.taskId === s.selected?.taskId
            }
            onSelect={s.select}
          />
        ))}
        {loading && (
          <div
            className="pn-row"
            data-kind="assistant"
            data-testid="pn-loading"
          >
            <span className="pn-time">{clock(Date.now())}</span>
            <span className="pn-text">
              {phaseLabel(s.phase, s.model.activity.key)}…
              {waited >= 3 && ` ${waited}s`}
            </span>
          </div>
        )}
        {!log.following && (
          <button
            type="button"
            className="pn-jump"
            aria-label="Jump to the latest"
            title="Jump to the latest"
            onClick={log.jump}
          >
            <Icon name="expand_more" />
            {log.unseen > 0 ? `${log.unseen} new` : "Latest"}
          </button>
        )}
      </div>
      <p
        className="pn-interim"
        data-testid="pn-interim"
        aria-live="polite"
        data-empty={s.live.interim === "" ? "true" : undefined}
      >
        <em>{s.live.interim}</em>
      </p>
      {s.note && (
        <p className="pn-note" role="alert">
          <span>{s.note}</span>
        </p>
      )}
      <form className="pn-compose" onSubmit={submit}>
        <input
          className="pn-input"
          aria-label="Message"
          ref={inputRef}
          placeholder={s.selected ? CONTEXT_PLACEHOLDER : CHAT_PLACEHOLDER}
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
