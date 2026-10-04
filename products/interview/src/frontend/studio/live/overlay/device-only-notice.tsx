// The one place a device-only session says what hands-free cannot do. Shown at
// the top of the live card while Auto is on; the Auto line, Activity and the
// bottom note do not repeat it. The owner chooses: the button only opens Setup
// with "Allow remote" remembered; it never starts or ends anything and never
// loosens the running session (ADR-0012).
import { Icon } from "../../icon";
import { saveHandsFreeChoice } from "../hands-free-choice";

export type DeviceOnlyNoticeInput = {
  deviceOnly: boolean;
  autoOn: boolean;
  // The native shell's engine listens (it has on-device speech).
  engine: boolean;
  // The browser recogniser's own refusal, when it was asked.
  dictationError: string | null;
  dictationSupported: boolean;
};

export function deviceOnlyNotice(
  input: DeviceOnlyNoticeInput,
): { off: string[] } | null {
  if (!input.deviceOnly || !input.autoOn) return null;
  const listening = input.engine
    ? "Listening uses the native engine’s on-device speech."
    : (input.dictationError ??
      (input.dictationSupported
        ? "Listening works only if this browser has on-device speech."
        : "This browser has no dictation. Use the native app, or type the follow-up."));
  return {
    off: ["Screenshots are not analysed and no code is generated.", listening],
  };
}

export function DeviceOnlyCard({
  input,
  tenant,
  onStartRemote,
}: {
  input: DeviceOnlyNoticeInput;
  tenant: string;
  onStartRemote(): void;
}) {
  const notice = deviceOnlyNotice(input);
  if (!notice) return null;
  return (
    <div
      className="ov-auto problem"
      role="status"
      data-testid="device-only-card"
    >
      <Icon name="warning" />
      <div className="ov-auto-text">
        <strong>This session is device-only, so hands-free is limited.</strong>
        {notice.off.map((line) => (
          <div key={line}>{line}</div>
        ))}
        <div>
          Processing can only be tightened once a session has started. To get
          both, start a new session; this one keeps running until you end it.
        </div>
      </div>
      <button
        type="button"
        className="ov-link"
        data-testid="device-only-remote"
        onClick={() => {
          saveHandsFreeChoice(tenant, "permitted-remote");
          onStartRemote();
        }}
      >
        Start a new session with remote allowed
      </button>
    </div>
  );
}
