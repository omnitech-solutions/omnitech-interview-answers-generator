import type { LiveCaptureSource } from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import type { StudioActions } from "../config/commands";
import { Icon } from "../icon";
import {
  capabilityAdvisories,
  NO_REPORT_DETAIL,
  permissionLines,
  reportAge,
  speechState,
} from "./companion-capability";
import type { SessionErrorCode } from "./session-client";
import { CREDENTIAL_LIFETIME_TEXT } from "./session-sources";
import { SwitchRow } from "./setup-controls";
import {
  buildStartRequest,
  defaultMatrix,
  initialForm,
  newRehearsalRunId,
  type SetupForm,
  startErrorMessage,
} from "./setup-model";
import {
  type DeviceOnlyBlocker,
  MatrixSection,
  ProcessingSection,
  RetentionSection,
  TargetSection,
} from "./setup-sections";
import { useCompanionCapability } from "./use-companion-capability";
import { useLiveSession } from "./use-live-session";
import { useSetupChoices } from "./use-setup-choices";

export type SetupViewProps = {
  // Studio navigation, for the matrix link.
  studio: StudioActions;
  // Reasons a device-only session cannot work on this machine; these alone
  // block Start. The companion's stored capability report is advisory only.
  deviceOnlyBlockers?: readonly DeviceOnlyBlocker[];
};

const SOURCES: readonly {
  value: LiveCaptureSource;
  title: string;
  description: string;
  icon: "mic" | "graphic_eq" | "desktop_windows";
}[] = [
  {
    value: "microphone",
    title: "Microphone",
    description: "Your voice",
    icon: "mic",
  },
  {
    value: "application-audio",
    title: "App audio",
    description: "The other side of the call",
    icon: "graphic_eq",
  },
  {
    value: "screen",
    title: "Screen",
    description:
      "Screenshots the companion sends are stored for you; no model reads them yet",
    icon: "desktop_windows",
  },
];

const NO_BLOCKERS: readonly DeviceOnlyBlocker[] = [];

// "Start a live session": target, consent, sources, assistance, matrix,
// locality and retention. Starting goes through `useLiveSession().actions.start`;
// once the store holds an open session the Live view switches to the live
// panel by itself, where the pairing credential is shown (PairingPanel).
export function SetupView({
  studio,
  deviceOnlyBlockers = NO_BLOCKERS,
}: SetupViewProps) {
  const { actions, snapshot } = useLiveSession();
  const companion = useCompanionCapability();
  const report = companion.status === "ready" ? companion.capability : null;
  // Only the passed blockers block Start. The stored report is owner-level and
  // a session credential can post one, so it is shown as an advisory; the
  // companion's own on-device check at start is the authority.
  const blockers = deviceOnlyBlockers;
  const advisories = capabilityAdvisories(report);
  const advisoryAge = report ? reportAge(report, Date.now()) : null;
  const { state: choices, reload } = useSetupChoices();
  const [form, setForm] = useState<SetupForm>(initialForm);
  const [failure, setFailure] = useState<SessionErrorCode | null>(null);
  const matrixTouched = useRef(false);
  // One id per Setup screen, so a retried start names the same rehearsal run.
  const runId = useRef<string | null>(null);
  const pending = snapshot.pending.includes("start");
  const patch = (next: Partial<SetupForm>) =>
    setForm((current) => ({ ...current, ...next }));

  // The matrix defaults to the latest revision until the owner chooses; a
  // choice that vanished from a reload falls back to the default.
  const profiles = choices.status === "ready" ? choices.choices.profiles : [];
  useEffect(() => {
    if (choices.status !== "ready") return;
    setForm((current) => {
      const known = [
        "none",
        ...choices.choices.profiles.map(
          (profile) => `${profile.profileId}@${profile.revision}`,
        ),
      ];
      return matrixTouched.current && known.includes(current.matrix)
        ? current
        : { ...current, matrix: defaultMatrix(choices.choices.profiles) };
    });
  }, [choices]);

  const rehearsal = form.target?.kind === "rehearsal";
  const strict = rehearsal && form.strict;
  const blocked = form.policy === "device-only" && blockers.length > 0;
  runId.current ??= newRehearsalRunId();
  const request = buildStartRequest(form, runId.current, profiles);
  const canStart = request !== null && !blocked && !pending;
  const missing = !form.target
    ? "Choose what the session is for."
    : form.sources.length === 0
      ? "Choose at least one source."
      : !form.consent
        ? "Confirm that everyone has agreed."
        : null;

  async function start() {
    if (!request || !canStart) return;
    setFailure(null);
    const result = await actions.start(request);
    if (result.ok) return;
    setFailure(result.code);
    // A refused link means the choices changed under us: read them again.
    if (result.code === "link_refused") reload();
  }
  const toggleSource = (source: LiveCaptureSource, on: boolean) =>
    patch({
      sources: on
        ? [...form.sources, source]
        : form.sources.filter((item) => item !== source),
    });

  return (
    <div className="live-page" data-testid="live-setup">
      <div className="setup-head">
        <h2>Start a live session</h2>
        <p className="live-note">
          Studio listens to the sources you choose, spots questions and coding
          tasks, and prepares grounded help. It never submits, sends or types
          anything for you.
        </p>
      </div>

      <TargetSection
        choices={choices}
        reload={reload}
        target={form.target}
        strict={form.strict}
        onTarget={(target) => patch({ target })}
        onStrict={(value) => patch({ strict: value })}
      />

      <label className={`setup-consent${form.consent ? "" : " needed"}`}>
        <input
          type="checkbox"
          checked={form.consent}
          onChange={(event) => patch({ consent: event.target.checked })}
        />
        <span>
          Everyone in this interview has agreed to it being recorded and to me
          using AI assistance.
          <span className="setup-muted">
            Required to start. Studio asks on this screen and does not store
            your answer.
          </span>
        </span>
      </label>

      <section className="setup-section">
        <h3>Capture companion</h3>
        <p className="setup-muted" data-testid="setup-companion">
          Pairing happens when you start: Studio shows a pairing credential,
          shown once and valid for up to {CREDENTIAL_LIFETIME_TEXT}, for the
          capture companion. Studio can’t tell whether the companion is running
          until it makes contact.
        </p>
        <CompanionReport state={companion} sources={form.sources} />
      </section>

      <fieldset className="setup-section">
        <legend>Sources</legend>
        {SOURCES.map((source) => (
          <SwitchRow
            key={source.value}
            id={`setup-source-${source.value}`}
            title={source.title}
            description={source.description}
            on={form.sources.includes(source.value)}
            onChange={(on) => toggleSource(source.value, on)}
          />
        ))}
        <p className="setup-muted">
          Only these sources are captured. The companion cannot add sources. You
          can stop it on the Mac at any time, even when Studio is unreachable;
          until you do, it keeps capturing and sends what it holds when Studio
          returns. Source labels aren’t speaker identities, and app audio can
          contain several people.
        </p>
      </fieldset>

      <fieldset className="setup-section">
        <legend>Assistance</legend>
        <SwitchRow
          id="setup-assistance"
          title="Live assistance"
          description="Drafts answers to the questions it hears and, for coding tasks, prepares a draft with tests in a private Workspace. Experience questions use only your matrix; concepts are labelled as general knowledge."
          on={strict ? false : form.assistance}
          disabled={strict}
          {...(strict
            ? { reason: "A strict rehearsal turns live assistance off." }
            : {})}
          onChange={(on) => patch({ assistance: on })}
        >
          {rehearsal && !strict && form.assistance && (
            <div className="setup-muted setup-reason">
              Each draft shown counts as a hint at the usual hint cost.
            </div>
          )}
        </SwitchRow>
      </fieldset>

      <MatrixSection
        choices={choices}
        value={form.matrix}
        onChange={(matrix) => {
          matrixTouched.current = true;
          patch({ matrix });
        }}
        onOpenBriefings={() => studio.go("briefings")}
      />
      <ProcessingSection
        value={form.policy}
        blockers={blockers}
        advisories={advisories}
        advisoryAge={advisoryAge}
        speechWarning={
          form.policy === "permitted-remote" &&
          report !== null &&
          speechState(report).blocksSpeech
        }
        onChange={(policy) => patch({ policy })}
      />
      <RetentionSection
        value={form.retention}
        onChange={(retention) => patch({ retention })}
      />

      {failure && (
        <div role="alert" className="setup-error" data-testid="setup-failure">
          <span>{startErrorMessage(failure)}</span>
          {failure === "open_session_exists" && (
            <button
              type="button"
              className="studio-button"
              onClick={() => void actions.refresh()}
            >
              Open it
            </button>
          )}
        </div>
      )}
      <div className="setup-start">
        <button
          type="button"
          className="studio-button primary"
          disabled={!canStart}
          onClick={() => void start()}
        >
          <Icon name="sensors" />
          {pending ? "Starting…" : "Start session"}
        </button>
        {missing && !pending && <span className="setup-muted">{missing}</span>}
      </div>
    </div>
  );
}

// The companion's LAST report, said as that: never "connected", never live.
function CompanionReport({
  state,
  sources,
}: {
  state: ReturnType<typeof useCompanionCapability>;
  sources: readonly LiveCaptureSource[];
}) {
  if (state.status === "loading")
    return (
      <p className="setup-muted" data-testid="setup-capability">
        Reading the companion’s last capability report…
      </p>
    );
  if (state.status === "error")
    return (
      <p className="setup-muted" data-testid="setup-capability">
        Studio couldn’t read the companion’s last capability report, so nothing
        is assumed about speech on this Mac. The companion checks when it starts
        and fails visibly if it can’t listen.
      </p>
    );
  const { capability } = state;
  if (!capability)
    return (
      <p className="setup-muted" data-testid="setup-capability">
        {NO_REPORT_DETAIL}
      </p>
    );
  const speech = speechState(capability);
  const denied = permissionLines(capability).filter(
    (line) => line.state === "denied" && sources.includes(line.source),
  );
  return (
    <div data-testid="setup-capability">
      <p className="setup-muted">
        The companion’s last report ({reportAge(capability, Date.now())}), not a
        live connection.
      </p>
      <dl className="setup-facts">
        <div>
          <dt>Speech</dt>
          <dd data-tone={speech.tone}>{speech.label}</dd>
        </div>
        {permissionLines(capability).map((line) => (
          <div key={line.source}>
            <dt>{line.label}</dt>
            <dd data-tone={line.tone}>{line.text}</dd>
          </div>
        ))}
      </dl>
      {denied.map((line) => (
        <p key={line.source} className="setup-muted">
          {line.label} access was denied for the companion on this Mac, so it
          can’t capture that source until you allow it in System Settings.
        </p>
      ))}
    </div>
  );
}
