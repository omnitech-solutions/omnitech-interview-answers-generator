// The panes beside the toolbar: the analysis (the answer pane and the code
// pane, in answer-pane.tsx), the transcript and chat (chat-panel.tsx), settings
// and the toasts. Each takes the one panel session (usePanelSession) and renders it;
// none fetches or decides anything itself.
//
// [SAFETY] The settings footer says plainly that this is a visible window that
// shows in screen shares. Nothing here hides a window or conceals capture.
import type { PresentationHost } from "@omnitech/interview-contracts";
import { ScreenshotSendControl } from "../../shared/screenshot-send-control";
import { SKILLS } from "../../shared/skills";
import { useScreenshotSend } from "../../shared/use-screenshot-send";
import { BUILD_ID } from "../build-id";
import { AnswerPane, CodePane } from "./answer-pane";
import { BehaviourFlagsSetting } from "./behaviour-flags-setting";
import { CallAudioSetting } from "./call-audio-setting";
import { DEFAULT_SKILL } from "./commands";
import {
  languageOptions,
  NOT_SUPPORTED_YET,
  supportedLanguage,
} from "./languages";
import type { usePanelSession } from "./use-panel-session";

export { ChatPanel } from "./chat-panel";

export type PanelSession = ReturnType<typeof usePanelSession>;

// ---- Analysis ---------------------------------------------------------------

// The one window shows the answer and the code as separate panes.
export function AnswerPanel({ s }: { s: PanelSession }) {
  return <AnswerPane s={s} />;
}

export function CodePanel({ s }: { s: PanelSession }) {
  return (
    <div className="pn-analysis" data-testid="pn-analysis">
      <CodePane s={s} />
    </div>
  );
}

// ---- Settings ---------------------------------------------------------------

// D35: where the processing policy lives, so do the related privacy choices.
function PrivacySettings({ s }: { s: PanelSession }) {
  const send = useScreenshotSend({
    session: s.session,
    pending: s.snapshot.pending,
    save: s.actions.setScreenshotSend,
  });
  return (
    <>
      <div className="pn-label">Privacy</div>
      <ScreenshotSendControl
        variant="native"
        value={send.value}
        saving={send.saving}
        failure={send.failure}
        disabledReason={send.disabledReason}
        onChange={send.choose}
      />
    </>
  );
}

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
        <CallAudioSetting />
        <BehaviourFlagsSetting />
        {s.session && <PrivacySettings s={s} />}
        <p className="pn-footer">
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
