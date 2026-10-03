// The Sources tab: each capture source's health, the companion's contact and
// credential, the pairing panel (shown once after a credential is issued), where
// processing runs, and the two one-way privacy controls: switch to this Mac only
// (ADR-0012/tighten-only-locality) and shorten retention
// (ADR-0012/owner-chooses-retention). Neither can be undone, so each confirms.
import type {
  LiveRetentionMode,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { type ReactNode, useState } from "react";
import { Icon, type IconName } from "../icon";
import { CapabilityTable } from "./capability-table";
import {
  NO_REPORT_DETAIL,
  permissionLines,
  reportAge,
  type SpeechState,
  speechState,
} from "./companion-capability";
import {
  PROMOTED_NOTE,
  RETENTION_LABEL,
  retentionMeaning,
  shorterRetentions,
} from "./ended-summary";
import { ageLabel, companionContact } from "./session-format";
import type { SessionActions } from "./session-snapshot";
import { CREDENTIAL_LIFETIME_TEXT, type SourceHealth } from "./session-sources";
import type { LiveViewModel } from "./session-state";
import {
  CAPABILITY_LOADING,
  type CompanionCapabilityState,
} from "./use-companion-capability";

const SOURCE_ICON: Record<string, IconName> = {
  microphone: "mic",
  "application-audio": "graphic_eq",
  screen: "screenshot_monitor",
};
const HEALTH: Record<SourceHealth, { text: string; tone: string }> = {
  receiving: { text: "Receiving", tone: "green" },
  waiting: { text: "Waiting for the companion", tone: "neutral" },
  disconnected: { text: "Disconnected", tone: "red" },
  "lost-permission": { text: "Permission revoked", tone: "red" },
  lost: { text: "Lost", tone: "red" },
  gap: { text: "Audio was dropped", tone: "amber" },
  "not-selected": { text: "Not selected", tone: "neutral" },
};

const NO_RECENT_CONTACT = { text: "No recent contact", tone: "neutral" };

// An irreversible change behind an inline confirmation. The failure is a fixed
// code from the server, never a message.
function ConfirmAction({
  label,
  question,
  confirmLabel,
  run,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  run(): Promise<{ ok: true } | { ok: false; code: string }>;
}) {
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!asking)
    return (
      <button
        type="button"
        className="studio-button"
        onClick={() => {
          setFailure(null);
          setAsking(true);
        }}
      >
        {label}
      </button>
    );
  return (
    <div className="live-confirm" role="group" aria-label={label}>
      <p>{question}</p>
      <div className="live-confirm-actions">
        <button
          type="button"
          className="studio-button"
          onClick={() => setAsking(false)}
        >
          Cancel
        </button>
        <button
          type="button"
          className="studio-button primary"
          onClick={async () => {
            const result = await run();
            if (result.ok) setAsking(false);
            else setFailure(result.code);
          }}
        >
          {confirmLabel}
        </button>
      </div>
      {failure && (
        <p className="live-note" role="alert">
          Couldn’t change this ({failure}).
        </p>
      )}
    </div>
  );
}

// The companion's LAST capability report: its speech state and the OS
// permissions it named. A report is history, not contact: it never says the
// companion is connected (that is the row above, from the heartbeat).
function CompanionReport({ state }: { state: CompanionCapabilityState }) {
  if (state.status === "loading") return null;
  if (state.status === "error")
    return (
      <p className="live-note" data-testid="companion-report">
        Studio couldn’t read the companion’s last capability report just now.
      </p>
    );
  const { capability } = state;
  if (!capability)
    return (
      <p className="live-note" data-testid="companion-report">
        {NO_REPORT_DETAIL}
      </p>
    );
  const speech = speechState(capability);
  return (
    <div data-testid="companion-report">
      <p className="live-note">
        Last capability report ({reportAge(capability, Date.now())}):{" "}
        {speech.detail}
      </p>
      <p className="live-note">
        {permissionLines(capability)
          .map((line) => `${line.label} ${line.text}`)
          .join(" · ")}
      </p>
    </div>
  );
}

function CompanionRow({
  model,
  capability,
}: {
  model: LiveViewModel;
  capability: CompanionCapabilityState;
}) {
  const { companion } = model;
  const contact = companionContact(companion);
  const credential: Record<typeof companion.credential, string> = {
    none: "No credential recorded.",
    valid: `Credential valid for about ${ageLabel(companion.credentialExpiresInMs ?? 0)}.`,
    "expiring-soon": `Credential expires in ${ageLabel(companion.credentialExpiresInMs ?? 0)}.`,
    expired: "Credential expired.",
    revoked: "Credential revoked.",
  };
  return (
    <li className="live-source" data-testid="companion-row">
      <Icon name="sensors" />
      <div>
        <div className="live-source-head">
          <strong>Capture companion</strong>
          <span className={`live-source-state ${contact.tone}`}>
            {contact.text}
          </span>
        </div>
        <p className="live-note">{credential[companion.credential]}</p>
        <p className="live-note">
          The credential is bound to this session. It can add observations,
          pause the session and post an advisory capability report; it can’t add
          sources, resume, end or delete the session. It lasts up to{" "}
          {CREDENTIAL_LIFETIME_TEXT} and is renewed here, by you.
        </p>
        <CompanionReport state={capability} />
      </div>
    </li>
  );
}

export function SourcesTab({
  model,
  session,
  actions,
  pairing,
  capability = CAPABILITY_LOADING,
}: {
  model: LiveViewModel;
  session: LiveSessionView;
  actions: SessionActions;
  // The pairing panel (a credential just issued), when there is one to show.
  pairing: ReactNode;
  // The companion's last capability report, read by the panel.
  capability?: CompanionCapabilityState;
}) {
  const speech: SpeechState | null =
    capability.status === "ready" ? speechState(capability.capability) : null;
  const locality = model.locality;
  const shorter = shorterRetentions(session.retention);
  return (
    <>
      <ul className="live-sources" aria-label="Capture sources">
        {model.sources.map((source) => {
          // "Receiving" was derived from earlier observations; it is only said
          // while the companion is in contact (the bar's chips follow the same
          // rule), never from history alone.
          const health =
            source.health === "receiving" && model.companion.status !== "online"
              ? NO_RECENT_CONTACT
              : HEALTH[source.health];
          return (
            <li
              key={source.source}
              className="live-source"
              data-health={source.health}
            >
              <Icon name={SOURCE_ICON[source.source] ?? "sensors"} />
              <div>
                <div className="live-source-head">
                  <strong>{source.label}</strong>
                  <span className={`live-source-state ${health.tone}`}>
                    {health.text}
                  </span>
                </div>
                <p className="live-note">{source.note}</p>
              </div>
            </li>
          );
        })}
        <CompanionRow model={model} capability={capability} />
      </ul>
      {pairing}
      {locality && (
        <section className="live-block" aria-label="Processing">
          <h4>Processing</h4>
          <p>
            <span className={`live-chip ${locality.tone}`}>
              {locality.label}
            </span>
          </p>
          <p className="live-note">{locality.meaning}</p>
          <CapabilityTable policy={locality.policy} speech={speech} />
          {locality.canTighten && (
            <ConfirmAction
              label="Switch to this Mac only"
              question="Switch this session to this Mac only? Anything that can’t run on this Mac will be refused, not sent elsewhere. This can’t be undone for this session."
              confirmLabel="Switch to this Mac only"
              run={() => actions.tightenLocality()}
            />
          )}
        </section>
      )}
      <section className="live-block" aria-label="Retention">
        <h4>Retention</h4>
        <p>
          <span className="live-chip neutral">
            {RETENTION_LABEL[session.retention]}
          </span>
        </p>
        <p className="live-note">{retentionMeaning(session)}</p>
        <p className="live-note">{PROMOTED_NOTE}</p>
        {shorter.map((mode) => (
          <ConfirmAction
            key={mode}
            label={`Shorten to ${RETENTION_LABEL[mode]}`}
            question={`Shorten retention to “${RETENTION_LABEL[mode]}”? It can only be shortened, never lengthened again.`}
            confirmLabel={`Shorten to ${RETENTION_LABEL[mode]}`}
            run={() => actions.shortenRetention(mode)}
          />
        ))}
      </section>
    </>
  );
}
