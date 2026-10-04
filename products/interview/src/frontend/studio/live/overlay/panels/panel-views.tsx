// The four panels. Each takes the one panel session (usePanelSession) and
// renders a focused, translucent-friendly view of it; none fetches or decides
// anything of its own. Views read presentation CAPABILITIES, never host names.
//
// [SAFETY] The settings footer says plainly that this is a visible window that
// shows in screen shares. Nothing here hides a window or conceals capture.
import { BUILD_ID } from "../build-id";
import {
  LIVE_OWNER_SKILL_LABELS,
  LIVE_OWNER_SKILLS,
  type LiveOwnerSkill,
  type PresentationHost,
  type PresentationPanel,
} from "@omnitech/interview-contracts";
import { type FormEvent, useState } from "react";
import { Icon } from "../../../icon";
import { TASK_KIND } from "../../task-panels";
import { LiveCodeCanvas } from "../code-canvas";
import { DeviceOnlyCard } from "../device-only-notice";
import { MaskEditor } from "../mask-editor";
import { localityChips, solution } from "../overlay-model";
import { shortcutKeys } from "../overlay-shortcuts";
import { taskHeading } from "../overlay-task";
import { openStartPage } from "../studio-links";
import { COMMAND_KEYS } from "./commands";
import {
  languageOptions,
  NOT_SUPPORTED_YET,
  supportedLanguage,
} from "./languages";
import { PANEL_LABEL } from "./panel-kinds";
import { clock, panelRows, taskSections } from "./panel-model";
import { hasCapability } from "./presentation-host";
import type { usePanelSession } from "./use-panel-session";

export type PanelSession = ReturnType<typeof usePanelSession>;
type Tone = "green" | "red" | "amber" | "neutral";

// green: live. red: recording, or interaction is off. amber: paused.
export function pillTone(s: PanelSession): { tone: Tone; label: string } {
  if (!s.open) return { tone: "neutral", label: "Ended" };
  if (s.paused) return { tone: "amber", label: "Paused" };
  if (s.live.mic === "listening") return { tone: "red", label: "Recording" };
  if (s.interaction === false) return { tone: "red", label: "Interaction off" };
  return { tone: "green", label: "Live" };
}

export const skillLabel = (skill: LiveOwnerSkill | undefined): string =>
  skill ? LIVE_OWNER_SKILL_LABELS[skill] : "Auto-detect";

// ---- Pill -------------------------------------------------------------------

export function PillPanel({
  s,
  presentation,
}: {
  s: PanelSession;
  presentation: PresentationHost;
}) {
  const status = pillTone(s);
  const [refused, setRefused] = useState<PresentationPanel | null>(null);
  const openPanel = async (panel: PresentationPanel) => {
    setRefused((await presentation.open(panel)) ? null : panel);
  };
  const analyze = shortcutKeys("analyze");
  return (
    <div
      className="pn-pill"
      role="toolbar"
      aria-label="Session controls"
      data-testid="pn-pill"
    >
      <button
        type="button"
        className="pn-icon"
        aria-label="Capture screenshot"
        title={`Capture & analyze (${analyze})`}
        disabled={!s.open}
        onClick={() => s.press("capture")}
      >
        <Icon name="screenshot_monitor" />
        <kbd>{analyze}</kbd>
      </button>
      <button
        type="button"
        className="pn-icon"
        aria-label={
          s.live.mic === "listening" ? "Stop microphone" : "Start microphone"
        }
        aria-pressed={s.live.mic === "listening"}
        data-mic={s.live.mic}
        title={`Microphone (${shortcutKeys("dictate")})`}
        disabled={!s.open}
        onClick={() => s.press("toggle-mic")}
      >
        <Icon
          name={s.live.mic === "listening" ? "mic" : "mic_off"}
          filled={s.live.mic === "listening"}
        />
      </button>
      <button
        type="button"
        className="pn-skill"
        data-testid="pn-skill"
        title="Active skill: change it in Settings"
        onClick={() => void openPanel("settings")}
      >
        {skillLabel(s.prefs.settings.skill)}
      </button>
      <span
        className="pn-dot"
        data-tone={status.tone}
        role="status"
        aria-label={status.label}
        title={status.label}
        data-testid="pn-dot"
      />
      <button
        type="button"
        className="pn-icon"
        aria-label="Open analysis"
        onClick={() => void openPanel("analysis")}
      >
        <Icon name="psychology" />
      </button>
      <button
        type="button"
        className="pn-icon"
        aria-label="Open chat"
        onClick={() => void openPanel("chat")}
      >
        <Icon name="forum" />
      </button>
      <button
        type="button"
        className="pn-icon"
        aria-label="Open settings"
        onClick={() => void openPanel("settings")}
      >
        <Icon name="settings" />
      </button>
      <span className="pn-visible" data-testid="pn-visible">
        Visible window · shows in screen shares
      </span>
      {s.engineLine && (
        <span className="pn-hint" role="status" data-testid="pn-engine">
          {s.engineLine}
        </span>
      )}
      {refused && (
        <span className="pn-hint" role="status">
          This window can’t open the {PANEL_LABEL[refused]} panel.
        </span>
      )}
    </div>
  );
}

// ---- Analysis ---------------------------------------------------------------

export function AnalysisPanel({ s }: { s: PanelSession }) {
  const task = s.selected;
  const code = task ? solution(task) : null;
  const kind = task ? TASK_KIND[task.kind] : null;
  const constraints =
    task?.constraints.filter((c) => c.status === "current") ?? [];
  const sections = task ? taskSections(task) : [];
  const heading = task ? taskHeading(task) : null;
  // The one error line can be dismissed; a different message shows again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  return (
    <div className="pn-card" data-testid="pn-analysis">
      <header className="pn-head">
        <span className="pn-title">{PANEL_LABEL.analysis}</span>
        {s.phase && (
          <span
            className="pn-analyzing"
            role="status"
            data-testid="pn-analyzing"
          >
            {s.phase === "capturing" ? "Capturing" : "Analyzing"}
            <span className="pn-ellipsis" aria-hidden="true">
              <i />
              <i />
            </span>
          </span>
        )}
      </header>
      {s.note && s.note !== dismissed && (
        <p className="pn-note" role="alert">
          <span>{s.note}</span>
          <button
            type="button"
            className="pn-icon"
            aria-label="Dismiss message"
            onClick={() => setDismissed(s.note)}
          >
            <Icon name="close" />
          </button>
        </p>
      )}
      {!task ? (
        <p className="pn-muted" data-testid="pn-analysis-empty">
          Nothing analysed yet. Capture the screen or ask a question.
        </p>
      ) : (
        <div className="pn-body">
          <h2 className="pn-problem" data-testid="pn-problem">
            {heading?.title}
          </h2>
          {heading?.restated && (
            <details className="pn-restated">
              <summary>Restated task</summary>
              <p>{heading.restated}</p>
            </details>
          )}
          <div className="pn-kv">
            <span className="pn-label">Problem type</span>
            <span data-testid="pn-type">{kind?.label}</span>
          </div>
          {constraints.length > 0 && (
            <div className="pn-chips" aria-label="Constraints">
              {constraints.map((c) => (
                <span key={c.text} className="pn-chip">
                  {c.text}
                </span>
              ))}
            </div>
          )}
          {sections.map((section) => (
            <section
              key={section.name}
              className="pn-section"
              aria-label={section.name}
            >
              <div className="pn-label">{section.name}</div>
              {section.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </section>
          ))}
          {code && (
            <section
              className="pn-code"
              aria-label="Code"
              data-testid="pn-code"
            >
              <div className="pn-label">
                CODE · <span data-testid="pn-language">{code.language}</span>
              </div>
              <LiveCodeCanvas
                result={code.result}
                revision={code.revision}
                density="maximized"
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Chat / transcription ---------------------------------------------------

export function ChatPanel({ s }: { s: PanelSession }) {
  const rows = panelRows(s.model, s.entries);
  const recording = s.live.mic === "listening";
  const stop = shortcutKeys("dictate");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = s.draft.trim();
    if (text === "") return;
    const result = await s.send(text);
    if (result.ok) s.setDraft("");
  };
  return (
    <div className="pn-card" data-testid="pn-chat">
      <header className="pn-head">
        <span className="pn-title">Live Transcription &amp; Chat</span>
        <span
          className="pn-dot"
          data-tone={recording ? "red" : "neutral"}
          role="status"
          aria-label={recording ? "Recording" : "Not recording"}
          data-testid="pn-rec"
        />
      </header>
      <DeviceOnlyCard
        tenant={s.tenant}
        input={{
          deviceOnly: s.deviceOnly,
          autoOn: s.live.auto,
          engine: s.engineAvailable,
          dictationError: s.dictationError,
          dictationSupported: s.dictationSupported,
        }}
        onStartRemote={() => openStartPage("overlay")}
      />
      <div className="pn-log" role="log" aria-label="Transcript and chat">
        {s.cleared && rows.length === 0 && (
          <p className="pn-system">Session memory cleared</p>
        )}
        {rows.map((row) => (
          <div key={row.key} className="pn-row" data-kind={row.kind}>
            <span className="pn-time">{clock(row.at)}</span>
            <span className="pn-who">{row.label}</span>
            <span className="pn-text">{row.text}</span>
          </div>
        ))}
        {recording && (
          <p className="pn-system" data-testid="pn-recording-line">
            Recording in progress — press {stop} to stop
          </p>
        )}
        {s.live.interim !== "" && (
          <p className="pn-interim" data-testid="pn-interim">
            <em>{s.live.interim}</em>
          </p>
        )}
      </div>
      {(s.note ?? (s.deviceOnly && s.live.auto ? null : s.dictationError)) && (
        <p className="pn-note" role="alert">
          {s.note ?? s.dictationError}
        </p>
      )}
      <form className="pn-compose" onSubmit={submit}>
        <input
          className="pn-input"
          aria-label="Message"
          placeholder="Type a message"
          value={s.draft}
          disabled={!s.open}
          onChange={(event) => s.setDraft(event.target.value)}
        />
        <button
          type="button"
          className="pn-icon"
          aria-label={recording ? "Stop microphone" : "Start microphone"}
          aria-pressed={recording}
          disabled={!s.open}
          onClick={() => s.press("toggle-mic")}
        >
          <Icon name="mic" filled={recording} />
        </button>
        <button
          type="submit"
          className="pn-icon pn-send"
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
  const [masking, setMasking] = useState(false);
  const settings = s.prefs.settings;
  const chips = s.session ? localityChips(s.session, s.snapshot.actions) : null;
  const clickThrough = hasCapability(presentation, "click-through");
  return (
    <div className="pn-card" data-testid="pn-settings">
      <header className="pn-head">
        <span className="pn-title">{PANEL_LABEL.settings}</span>
      </header>
      <div className="pn-body">
        <label className="pn-field">
          <span className="pn-label">Language</span>
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
          <span className="pn-label">Active skill</span>
          <select
            className="pn-select"
            data-testid="pn-skill-select"
            value={settings.skill ?? ""}
            onChange={(event) =>
              s.prefs.setSettings({
                ...settings,
                skill: LIVE_OWNER_SKILLS.find((v) => v === event.target.value),
              })
            }
          >
            <option value="">Auto-detect</option>
            {LIVE_OWNER_SKILLS.map((value) => (
              <option key={value} value={value}>
                {LIVE_OWNER_SKILL_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <div className="pn-kv">
          <span className="pn-label">Processing</span>
          <span data-testid="pn-locality">
            {s.deviceOnly ? "Device only" : "Remote allowed"}
            {chips ? ` · ${chips.locality.text}` : ""}
          </span>
        </div>
        <div className="pn-kv">
          <span className="pn-label">Retention</span>
          <span data-testid="pn-retention">{s.session?.retention ?? "—"}</span>
        </div>
        <div className="pn-kv">
          <span className="pn-label">Auto mode</span>
          <button
            type="button"
            className="pn-toggle"
            aria-pressed={s.live.auto}
            data-testid="pn-auto"
            onClick={() => s.setAuto(!s.live.auto)}
          >
            {s.live.auto ? "On" : "Off"}
          </button>
        </div>
        {clickThrough && (
          <div className="pn-kv">
            <span className="pn-label">Interaction mode</span>
            <button
              type="button"
              className="pn-toggle"
              aria-pressed={s.interaction !== false}
              data-testid="pn-interaction"
              onClick={() =>
                void presentation.setInteractionMode(s.interaction === false)
              }
            >
              {s.interaction === false ? "Off" : "On"}
            </button>
          </div>
        )}
        <div className="pn-kv">
          <span className="pn-label">Capture region</span>
          <button
            type="button"
            className="pn-toggle"
            onClick={() => setMasking(true)}
          >
            Edit region…
          </button>
        </div>
        {s.owns && s.share.status !== "sharing" && (
          <div className="pn-kv">
            <span className="pn-label">Screen</span>
            <button
              type="button"
              className="pn-toggle"
              onClick={() => void s.share.start()}
            >
              Share a window or screen…
            </button>
          </div>
        )}
        <div
          className="pn-shortcuts"
          aria-label="Commands and hotkeys"
          data-testid="pn-commands"
        >
          <div className="pn-label">Commands</div>
          {COMMAND_KEYS.map((each) => (
            <button
              key={each.command}
              type="button"
              className="pn-shortcut"
              data-command={each.command}
              title={`Run ${each.command}`}
              onClick={() => s.run(each.command)}
            >
              <kbd>{each.keys}</kbd>
              <code>{each.command}</code>
              <span>{each.label}</span>
            </button>
          ))}
        </div>
        <p className="pn-footer">Visible window · shows in screen shares</p>
        <p className="pn-footer" data-testid="pn-build">
          Build {BUILD_ID}
        </p>
      </div>
      {masking && (
        <MaskEditor
          variant={s.owns && s.share.stream ? "browser" : "display"}
          stream={s.owns ? s.share.stream : null}
          initial={
            s.owns && s.share.stream ? s.prefs.mask : s.prefs.displayMask
          }
          onSave={(rect) => {
            if (s.owns && s.share.stream) s.prefs.setMask(rect);
            else s.prefs.setDisplayMask(rect);
            setMasking(false);
          }}
          onClose={() => setMasking(false)}
        />
      )}
    </div>
  );
}

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
          {toast.text}
        </div>
      ))}
    </div>
  );
}
