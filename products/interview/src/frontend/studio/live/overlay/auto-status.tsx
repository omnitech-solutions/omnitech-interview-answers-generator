// The Auto control's one line, shown under the command bar whenever Auto is on,
// with the single way to turn it off (ADR-0022: always shown as on, one click
// to stop). A problem line names the one thing that needs the owner.
import { Icon } from "../../icon";
import type { AutoLine } from "./auto-line";

export const AUTO_AUDIO_NOTE =
  "Auto listens through this browser’s microphone. Audio from a call or another tab needs the native companion.";

export function AutoStatus({
  line,
  onStop,
}: {
  line: AutoLine;
  onStop(): void;
}) {
  return (
    <div
      className={`ov-auto ${line.tone}`}
      role="status"
      data-testid="auto-status"
      data-tone={line.tone}
      title={AUTO_AUDIO_NOTE}
    >
      <Icon name={line.tone === "problem" ? "warning" : "visibility"} />
      <span className="ov-auto-text">{line.text}</span>
      <button
        type="button"
        className="ov-link"
        data-testid="auto-stop"
        onClick={onStop}
      >
        Turn off
      </button>
    </div>
  );
}
