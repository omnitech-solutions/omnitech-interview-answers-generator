// Settings › Capture › Call audio: how this Mac captures the other side of the
// call. The shell owns the choice (it is a fact about this Mac, kept in the
// shell's own preferences) and the page only shows and changes it through the
// account bridge. A browser, or a shell that only knows screen capture, has no
// such bridge member and shows nothing rather than a dead control.
//
// [SAFETY] The line under the choice says what it really costs: the sharing
// indicator, the permission macOS asks for, and when a chosen tap is not what
// is running.
import { Select } from "@oc-tech/omni-ui-components";
import { CALL_AUDIO_OPTIONS, callAudioNote } from "./start-model";
import { useCallAudio } from "./use-call-audio";

export function CallAudioSetting() {
  const { callAudio, choose } = useCallAudio(null);
  if (!callAudio) return null;
  return (
    <>
      <div className="pn-label">Capture</div>
      <Select
        label="Call audio"
        data-testid="pn-call-audio-select"
        value={callAudio.selected}
        onChange={(value) => void choose(value)}
        options={CALL_AUDIO_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          disabled: option.value === "processTap" && !callAudio.tapSupported,
        }))}
      />
      <p className="pn-footer" data-testid="pn-call-audio-note">
        {callAudioNote(callAudio)}
      </p>
    </>
  );
}
