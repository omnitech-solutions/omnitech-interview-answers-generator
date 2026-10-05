// The capture companion is an optional upgrade (system audio, the focused
// window): the browser alone can capture, dictate and take typed follow-ups.
// While it has not made contact this is ONE line, "Capture companion: not
// connected", with a "Set up" disclosure of three numbered steps, each with a
// copy button. The moment contact happens the card swaps it for the source lights.
import { useState } from "react";
import { Icon } from "../../icon";
import { copyText } from "../shared/copy-text";

export const COMPANION_STEPS = [
  {
    id: "build",
    title: "Build and launch the companion app",
    command: "cd apps/capture-companion/macos && swift build -c release",
  },
  {
    id: "pair",
    title: "Paste the pairing credential",
    command: "swift run capture-companion pair",
    detail:
      "Run this, then paste the credential when asked. Copy the credential with the button below (it is shown once).",
  },
  {
    id: "run",
    title: "Start capturing",
    command: "swift run capture-companion run --screen",
    detail: "Add --microphone or --app-audio for system audio.",
  },
] as const;

export const COMPANION_LINE = "Capture companion: not connected";

export function CompanionSetup({
  credential,
}: {
  // The one-time pairing credential, while the store still holds it.
  credential: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(id: string, text: string) {
    setCopied((await copyText(text)) ? id : `failed-${id}`);
  }
  return (
    <div className="ov-companion" data-testid="companion-line">
      <div className="ov-companion-head">
        <Icon name="devices" />
        <span>{COMPANION_LINE}</span>
        <button
          type="button"
          className="ov-link"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Set up
        </button>
      </div>
      {open && (
        <ol className="ov-steps" data-testid="companion-steps">
          {COMPANION_STEPS.map((step) => (
            <li key={step.id} className="ov-step">
              <div className="ov-step-title">{step.title}</div>
              <div className="ov-step-command">
                <code>{step.command}</code>
                <button
                  type="button"
                  className="ov-icon-button"
                  aria-label={`Copy command: ${step.title}`}
                  title="Copy the command"
                  onClick={() => void copy(step.id, step.command)}
                >
                  <Icon name={copied === step.id ? "check" : "content_copy"} />
                </button>
              </div>
              {"detail" in step && (
                <div className="ov-menu-sub">{step.detail}</div>
              )}
              {step.id === "pair" && credential && (
                <button
                  type="button"
                  className="ov-button"
                  onClick={() => void copy("credential", credential)}
                >
                  <Icon name="content_copy" />
                  {copied === "credential" ? "Copied" : "Copy credential"}
                </button>
              )}
              {copied === `failed-${step.id}` && (
                <div className="ov-note">
                  Couldn’t copy. Select the command and copy it yourself.
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
