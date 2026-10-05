// The panes beside the toolbar: the analysis (the answer pane and the code
// pane, in answer-pane.tsx), the live transcription and chat, settings and the
// toasts. Each takes the one panel session (usePanelSession) and renders it;
// none fetches or decides anything itself.
//
// [SAFETY] The settings footer says plainly that this is a visible window that
// shows in screen shares. Nothing here hides a window or conceals capture.
import type { PresentationHost } from "@omnitech/interview-contracts";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "../../../icon";
import { SKILLS } from "../../shared/skills";
import { BUILD_ID } from "../build-id";
import type { ApproachItem } from "../overlay-model";
import { AnswerPane, CodePane } from "./answer-pane";
import { DEFAULT_SKILL, FOCUS_INPUT_EVENT } from "./commands";
import { useFollowLatest } from "./follow-latest";
import {
  languageOptions,
  NOT_SUPPORTED_YET,
  supportedLanguage,
} from "./languages";
import {
  clock,
  followUpPlaceholder,
  type PanelRow,
  panelRows,
  type TaskStage,
} from "./panel-model";
import { phaseLabel } from "./toolbar-config";
import { useElapsed } from "./use-elapsed";
import type { usePanelSession } from "./use-panel-session";

export type PanelSession = ReturnType<typeof usePanelSession>;

// ---- Analysis ---------------------------------------------------------------

export function AnalysisPanel({
  s,
  part,
  autoWatching = false,
}: {
  s: PanelSession;
  // The one window shows the answer and the code as separate panes.
  part: "text" | "code";
  autoWatching?: boolean;
}) {
  return (
    <div className="pn-analysis" data-testid="pn-analysis">
      {part === "text" ? (
        <AnswerPane s={s} autoWatching={autoWatching} />
      ) : (
        <CodePane s={s} />
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
  if (row.kind === "marker")
    return (
      <div className="pn-marker" data-testid="pn-marker">
        {row.icon && <Icon name={row.icon} />}
        <span>{row.text}</span>
      </div>
    );
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
      data-speaker={row.speaker}
      data-selected={selected ? "true" : undefined}
      {...choose}
    >
      <span className="pn-who">
        {row.kind !== "system" && (
          <span className="pn-who-label">{row.label}</span>
        )}
        <span className="pn-time">{clock(row.at)}</span>
      </span>
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
  const rows = panelRows(s.model, s.entries, s.system, s.clearedAt, s.markers);
  // A follow-up is on its way to the server: the reply is not here yet.
  const answering = s.snapshot.pending.includes("follow-up");
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
    `${loading}-${answering}-${last?.stage?.label}-${last?.items?.length ?? 0}`,
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
    // Words typed while it was sending stay in the box.
    if (result.ok) s.setDraft((now) => (now.trim() === text ? "" : now));
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
        {answering && (
          <div className="pn-pending" role="status" data-testid="pn-pending">
            <span className="pn-spinner" aria-hidden="true" />
            Answering your follow-up…
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
          placeholder={followUpPlaceholder(s.target?.targetLabel ?? null)}
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
    if (!(await presentation.closeSettings())) window.close();
  };
  // Without a shell to ask, a window can only close itself.
  const quit = () => {
    if (presentation.quit) void presentation.quit();
    else window.close();
  };
  return (
    <div className="pn-card pn-settings" data-testid="pn-settings">
      <header className="pn-head">
        <span className="pn-title">Settings</span>
        <button
          type="button"
          className="pn-danger"
          data-testid="pn-quit"
          onClick={quit}
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
            value={s.skill ?? DEFAULT_SKILL}
            onChange={(event) => {
              const chosen = SKILLS.find(
                (option) => option.id === event.target.value,
              );
              if (chosen) s.setSkill(chosen.id);
            }}
          >
            {SKILLS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
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
          {toast.detail !== "" && (
            <div className="pn-toast-detail">{toast.detail}</div>
          )}
        </div>
      ))}
    </div>
  );
}
