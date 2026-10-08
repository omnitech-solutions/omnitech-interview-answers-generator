// Settings › Capture › Call audio: how this Mac captures the other side of the
// call. The shell owns the choice (it is a fact about this Mac, kept in the
// shell's own preferences) and the page only shows and changes it through the
// account bridge. A browser, or a shell that only knows screen capture, has no
// such bridge member and shows nothing rather than a dead control.
//
// [SAFETY] The line under the choice says what it really costs: the sharing
// indicator, the permission macOS asks for, and when a chosen tap is not what
// is running.
import {
  type AccountCallAudio,
  CALL_AUDIO_SOURCES,
} from "@omnitech/interview-contracts";
import { useEffect, useState } from "react";
import { CALL_AUDIO_OPTIONS, callAudioNote } from "./start-model";
import { accountHost } from "./use-account";

export function CallAudioSetting() {
  const host = accountHost();
  const [callAudio, setCallAudio] = useState<AccountCallAudio | null>(null);
  useEffect(() => {
    if (!host) return;
    let live = true;
    host.permissions().then(
      (next) => live && setCallAudio(next.callAudio ?? null),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [host]);
  const save = host?.setCallAudio;
  if (!host || !save || !callAudio) return null;
  const choose = async (value: string) => {
    const source = CALL_AUDIO_SOURCES.find((each) => each === value);
    if (!source) return;
    // The shell answers what now applies; a refusal leaves the choice as it was.
    const next = await save.call(host, source);
    if (next?.callAudio) setCallAudio(next.callAudio);
  };
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
