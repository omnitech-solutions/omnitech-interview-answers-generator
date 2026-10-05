import { useEffect, useState } from "react";
import { Icon } from "../icon";
import type { CommandResult } from "./session-snapshot";
import { CREDENTIAL_LIFETIME_TEXT } from "./session-sources";
import { copyText } from "./shared/copy-text";
import { useLiveSession } from "./use-live-session";

// Pairing the capture companion with the open session: the credential controls
// that sit INSIDE the one companion block of the Sources tab (sources-tab.tsx
// owns its title, its status and its credential line; this adds none of them). The one-time credential
// (from start or renewal) is shown here, masked until the owner reveals it,
// and lives only in the session store's `pairing` field: this component never
// writes it to storage, a URL or a log (rule:credential-storage). Dismissing
// clears it. Mounted by the live view (and its Sources tab); renders nothing
// when no session is open.

const MASK = "••••••••••••••••";

// What the revoke did, said from the session record read AFTER it. The server
// pauses only a session that was active; for any other status it changes
// nothing, so this never says "paused" unless the record does.
function revokedNote(status: string | undefined): string {
  return status === "paused"
    ? "Credential revoked. The session is paused: renew a credential and resume to continue."
    : `Credential revoked. The session is still ${status ?? "open"}; it was not paused.`;
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
  const [revoked, setRevoked] = useState(false);
  const credentialValue = pairing?.value ?? null;
  // A new credential (renewal) starts masked again.
  useEffect(() => {
    setShown(false);
    setCopied("idle");
    // A new credential replaces the revoked one; clearing it does not.
    if (credentialValue) setRevoked(false);
  }, [credentialValue]);

  if (model.phase !== "open") return null;
  const busy = snapshot.pending.some(
    (command) => command === "renew" || command === "revoke",
  );

  async function copy() {
    if (!pairing) return;
    setCopied((await copyText(pairing.value)) ? "done" : "failed");
  }
  async function run(command: Promise<CommandResult>, revoking = false) {
    const result = await command;
    if (revoking) setRevoked(result.ok);
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
      aria-label="Pairing credential"
      data-testid="pairing-panel"
    >
      {pairing ? (
        <div className="pairing-credential">
          <p className="setup-muted">
            Give this pairing credential to the capture companion. It is shown
            once and valid for up to {CREDENTIAL_LIFETIME_TEXT}; Studio won’t
            show it again once dismissed.
          </p>
          <div className="pairing-value-row">
            {/* No aria-label: it would replace the revealed text. The Show
                button's pressed state announces the reveal. */}
            <code className="pairing-value" data-testid="pairing-credential">
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
              `Expires at ${timeOf(pairing.expiresAt)}. Renew it here before then.`}
          </p>
        </div>
      ) : (
        <p className="setup-muted">
          The pairing credential is no longer shown. Renew to get a new one; it
          replaces the old one.
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
              onClick={() => void run(actions.revokeCredential(), true)}
            >
              {snapshot.session?.status === "active"
                ? "Revoke and pause"
                : "Confirm revoke"}
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
      {revoked && (
        <p role="status" className="setup-muted" data-testid="revoke-result">
          {revokedNote(snapshot.session?.status)}
        </p>
      )}
      {failure && (
        <p role="alert" className="setup-error">
          {failure}
        </p>
      )}
    </section>
  );
}
