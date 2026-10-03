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
  PROMOTED_NOTE,
  RETENTION_LABEL,
  retentionMeaning,
  shorterRetentions,
} from "./ended-summary";
import { ageLabel, companionContact } from "./session-format";
import type { SessionActions } from "./session-snapshot";
import type { SourceHealth } from "./session-sources";
import type { LiveViewModel } from "./session-state";

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

function CompanionRow({ model }: { model: LiveViewModel }) {
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
          The credential is bound to this session and can only add to it; the
          companion can’t add sources. It lasts up to 2 hours and is renewed
          here, by you.
        </p>
      </div>
    </li>
  );
}

export function SourcesTab({
  model,
  session,
  actions,
  pairing,
}: {
  model: LiveViewModel;
  session: LiveSessionView;
  actions: SessionActions;
  // The pairing panel (a credential just issued), when there is one to show.
  pairing: ReactNode;
}) {
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
        <CompanionRow model={model} />
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
          <CapabilityTable policy={locality.policy} />
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
