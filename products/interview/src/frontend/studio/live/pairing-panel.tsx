import { useEffect, useState } from "react";
import { Icon } from "../icon";
import { ageLabel, companionContact } from "./session-format";
import type { CommandResult } from "./session-snapshot";
import type { CompanionModel } from "./session-sources";
import { useLiveSession } from "./use-live-session";

// Pairing the capture companion with the open session. The one-time credential
// (from start or renewal) is shown here, masked until the owner reveals it,
// and lives only in the session store's `pairing` field: this component never
// writes it to storage, a URL or a log (rule:credential-storage). Dismissing
// clears it. Mounted by the live view (and its Sources tab); renders nothing
// when no session is open.

const MASK = "••••••••••••••••";

export function companionChip(companion: CompanionModel): {
  tone: "amber" | "green" | "red";
  text: string;
} {
  return companionContact(companion);
}

function credentialLine(companion: CompanionModel): string | null {
  switch (companion.credential) {
    case "revoked":
      return "The credential was revoked. Renew to pair the companion again.";
    case "expired":
      return "The credential expired and capture is paused. Renew to continue.";
    case "expiring-soon":
      return `The credential expires in ${ageLabel(companion.credentialExpiresInMs ?? 0)}. Renew before then.`;
    default:
      return null;
  }
}

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function PairingPanel() {
  const { snapshot, actions, model } = useLiveSession();
  const pairing = snapshot.pairing;
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const credentialValue = pairing?.value ?? null;
  // A new credential (renewal) starts masked again.
  useEffect(() => {
    setShown(false);
    setCopied("idle");
  }, [credentialValue]);

  if (model.phase !== "open") return null;
  const chip = companionChip(model.companion);
  const note = credentialLine(model.companion);
  const busy = snapshot.pending.some(
    (command) => command === "renew" || command === "revoke",
  );

  async function copy() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.value);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }
  async function run(command: Promise<CommandResult>) {
    const result = await command;
    setFailure(
      result.ok
        ? null
        : `That didn’t work (${result.code}). The session is unchanged.`,
    );
    setConfirmRevoke(false);
  }

  return (
    <section
      className="pairing-panel"
      aria-labelledby="pairing-title"
      data-testid="pairing-panel"
    >
      <div className="pairing-head">
        <h3 id="pairing-title">Capture companion</h3>
        <span
          className={`live-chip ${chip.tone}`}
          data-testid="pairing-status"
          role="status"
        >
          {chip.text}
        </span>
      </div>
      {pairing ? (
        <div className="pairing-credential">
          <p className="setup-muted">
            Give this pairing credential to the capture companion. It is shown
            once and valid for up to 2 hours; Studio won’t show it again once
            dismissed.
          </p>
          <div className="pairing-value-row">
            <code
              className="pairing-value"
              data-testid="pairing-credential"
              aria-label="Pairing credential"
            >
              {shown ? pairing.value : MASK}
            </code>
            <button
              type="button"
              className="studio-button"
              aria-pressed={shown}
              onClick={() => setShown((current) => !current)}
            >
              <Icon name={shown ? "visibility_off" : "visibility"} />
              {shown ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              className="studio-button"
              onClick={() => void copy()}
            >
              <Icon name="content_copy" />
              Copy
            </button>
          </div>
          <p className="setup-muted" aria-live="polite">
            {copied === "done" && "Copied. Paste it into the companion."}
            {copied === "failed" && "Couldn’t copy. Show it and copy by hand."}
            {copied === "idle" &&
              `Expires at ${timeOf(pairing.expiresAt)}. A credential lasts up to 2 hours and never outlasts the session; renew it here before it expires.`}
          </p>
        </div>
      ) : (
        <p className="setup-muted">
          The pairing credential is no longer shown. Renew to get a new one; it
          replaces the old one.
        </p>
      )}
      {note && (
        <p className="setup-muted" data-testid="pairing-note">
          {note}
        </p>
      )}
      <div className="pairing-actions">
        <button
          type="button"
          className="studio-button"
          disabled={busy}
          onClick={() => void run(actions.renewCredential())}
        >
          Renew
        </button>
        {confirmRevoke ? (
          <>
            <button
              type="button"
              className="studio-button danger"
              disabled={busy}
              onClick={() => void run(actions.revokeCredential())}
            >
              Revoke and pause
            </button>
            <button
              type="button"
              className="studio-button"
              onClick={() => setConfirmRevoke(false)}
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            className="studio-button"
            disabled={busy}
            onClick={() => setConfirmRevoke(true)}
          >
            Revoke
          </button>
        )}
        {pairing && (
          <button
            type="button"
            className="studio-button"
            onClick={() => actions.dismissPairing()}
          >
            Dismiss
          </button>
        )}
      </div>
      {failure && (
        <p role="alert" className="setup-error">
          {failure}
        </p>
      )}
    </section>
  );
}
