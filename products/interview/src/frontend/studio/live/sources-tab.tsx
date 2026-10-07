// The Sources tab: each capture source's health, the companion's contact and
// credential, the pairing panel (shown once after a credential is issued), where
// processing runs, and the two one-way privacy controls: switch to this Mac only
// (ADR-0012/tighten-only-locality) and shorten retention
// (ADR-0012/owner-chooses-retention). Neither can be undone, so each confirms.
import type { LiveSessionView } from "@omnitech/interview-contracts";
import { type ReactNode, useState } from "react";
import { Button } from "../../ui";
import { Icon, type IconName } from "../icon";
import { CapabilityTable } from "./capability-table";
import { type SpeechState, speechState } from "./companion-capability";
import { CompanionReport } from "./companion-report";
import {
  PROMOTED_NOTE,
  RETENTION_LABEL,
  retentionMeaning,
  shorterRetentions,
} from "./ended-summary";
import { ageLabel, companionContact, companionImpact } from "./session-format";
import type { SessionActions, SessionCommand } from "./session-snapshot";
import { CREDENTIAL_LIFETIME_TEXT } from "./session-sources";
import type { LiveViewModel } from "./session-state";
import { ScreenshotSendControl } from "./shared/screenshot-send-control";
import { useScreenshotSend } from "./shared/use-screenshot-send";
import { shownHealth } from "./source-health";
import {
  CAPABILITY_LOADING,
  type CompanionCapabilityState,
} from "./use-companion-capability";

const SOURCE_ICON: Record<string, IconName> = {
  microphone: "mic",
  "application-audio": "graphic_eq",
  screen: "screenshot_monitor",
};
// What each source needs when the capture companion is not in contact. The
// browser covers screen capture and dictation on its own; system audio needs the
// companion.
const WITHOUT_COMPANION: Record<string, string> = {
  microphone:
    "Needs the capture companion. Dictation in the browser works without it.",
  "application-audio": "Needs the capture companion for system audio.",
  screen: "Use Capture & analyze to share a window or screen.",
};

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
      <Button
        size="lg"
        onClick={() => {
          setFailure(null);
          setAsking(true);
        }}
      >
        {label}
      </Button>
    );
  return (
    <div className="live-confirm" role="group" aria-label={label}>
      <p>{question}</p>
      <div className="live-confirm-actions">
        <Button size="lg" onClick={() => setAsking(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={async () => {
            const result = await run();
            if (result.ok) setAsking(false);
            else setFailure(result.code);
          }}
        >
          {confirmLabel}
        </Button>
      </div>
      {failure && (
        <p className="live-note" role="alert">
          Couldn’t change this ({failure}).
        </p>
      )}
    </div>
  );
}

// The ONE companion block: its title, its status once, its credential line once,
// and the pairing credential controls directly beneath (they add no title or
// status of their own).
function CompanionRow({
  model,
  capability,
  pairing,
  pairingOpen,
  onPair,
}: {
  model: LiveViewModel;
  capability: CompanionCapabilityState;
  pairing: ReactNode;
  pairingOpen: boolean;
  onPair(): void;
}) {
  const { companion } = model;
  // Only the companion can supply the microphone and application audio; the
  // screen can also be shared from the browser.
  const dependsOn = model.sources
    .filter(
      (item) =>
        item.selected &&
        (item.source === "microphone" || item.source === "application-audio"),
    )
    .map((item) => item.label);
  const contact = companionContact(companion, dependsOn);
  const impact = companionImpact(companion, dependsOn);
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
          <span
            className={`live-source-state ${contact.tone}`}
            data-testid="pairing-status"
            role="status"
          >
            {contact.text}
          </span>
        </div>
        {impact && (
          <p className="live-note" data-testid="companion-impact" role="alert">
            {impact}
          </p>
        )}
        <p className="live-note">{credential[companion.credential]}</p>
        <p className="live-note">
          The credential is bound to this session. It can add observations,
          pause the session and post an advisory capability report; it can’t add
          sources, resume, end or delete the session. It lasts up to{" "}
          {CREDENTIAL_LIFETIME_TEXT} and is renewed here, by you.
        </p>
        <CompanionReport
          state={capability}
          sources={model.sources
            .filter((item) => item.selected)
            .map((item) => item.source)}
          showFacts
        />
        {pairingOpen ? (
          pairing
        ) : (
          <Button size="lg" onClick={onPair}>
            <Icon name="link" />
            Pair capture companion
          </Button>
        )}
      </div>
    </li>
  );
}

export function SourcesTab({
  model,
  session,
  actions,
  pairing,
  pairingOpen,
  onPair,
  capability = CAPABILITY_LOADING,
  pending = [],
}: {
  model: LiveViewModel;
  session: LiveSessionView;
  actions: SessionActions;
  // The pairing panel. It stays out of sight until the owner asks for it (or a
  // credential was just issued), so a credential is never on screen by default.
  pairing: ReactNode;
  pairingOpen: boolean;
  onPair(): void;
  // The companion's last capability report, read by the panel.
  capability?: CompanionCapabilityState;
  // The store's pending commands: a remount during a save keeps the
  // Screenshots control locked while the POST is out.
  pending?: readonly SessionCommand[];
}) {
  const speech: SpeechState | null =
    capability.status === "ready" ? speechState(capability.capability) : null;
  const locality = model.locality;
  const send = useScreenshotSend({
    session,
    pending,
    save: actions.setScreenshotSend,
  });
  const shorter = shorterRetentions(session.retention);
  return (
    <>
      <ul className="live-sources" aria-label="Capture sources">
        {model.sources.map((source) => {
          const health = shownHealth(
            source,
            model.companion.status === "online",
          );
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
                    {health.label}
                  </span>
                </div>
                <p className="live-note">
                  {model.companion.status !== "online" && source.selected
                    ? (WITHOUT_COMPANION[source.source] ?? source.note)
                    : source.note}
                </p>
              </div>
            </li>
          );
        })}
        <CompanionRow
          model={model}
          capability={capability}
          pairing={pairing}
          pairingOpen={pairingOpen}
          onPair={onPair}
        />
      </ul>
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
      <section className="live-block" aria-label="Screenshots to the model">
        <h4>Screenshots to the model</h4>
        <p className="live-note">
          Each screenshot says what was sent. A change applies to the next model
          call.
        </p>
        <ScreenshotSendControl
          variant="web"
          value={send.value}
          saving={send.saving}
          failure={send.failure}
          disabledReason={send.disabledReason}
          onChange={send.choose}
        />
      </section>
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
