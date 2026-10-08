// Settings › Capture › Call audio: how this Mac captures the other side of the
// call. The shell owns the choice (it is a fact about this Mac, kept in the
// shell's own preferences) and the page only shows and changes it through the
// account bridge. A browser, or a shell that only knows screen capture, has no
// such bridge member and shows nothing rather than a dead control.
//
// [SAFETY] The line under the choice says what it really costs: the sharing
// indicator, the permission macOS asks for, and when a chosen tap is not what
// is running.
import { CALL_AUDIO_OPTIONS, callAudioNote } from "./start-model";
import { useCallAudio } from "./use-call-audio";

export function CallAudioSetting() {
  const { callAudio, choose } = useCallAudio(null);
  if (!callAudio) return null;
  return (
    <>
      <div className="pn-label">Capture</div>
      <label className="pn-field">
        <span>Call audio</span>
        <select
          className="pn-select"
          data-testid="pn-call-audio-select"
          value={callAudio.selected}
          onChange={(event) => void choose(event.target.value)}
        >
          {CALL_AUDIO_OPTIONS.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={
                option.value === "processTap" && !callAudio.tapSupported
              }
            >
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="pn-footer" data-testid="pn-call-audio-note">
        {callAudioNote(callAudio)}
      </p>
    </>
  );
}
