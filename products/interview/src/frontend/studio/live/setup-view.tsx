import type { LiveCaptureSource } from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import type { StudioActions } from "../config/commands";
import { Icon } from "../icon";
import {
  capabilityAdvisories,
  reportAge,
  speechState,
} from "./companion-capability";
import { CompanionReport } from "./companion-report";
import { loadHandsFreeChoice, saveHandsFreeChoice } from "./hands-free-choice";
import { studioHostInfo } from "./host-adapter";
import { saveAutoPreferred } from "./overlay/auto-prefs";
import { recognitionCtor } from "./overlay/dictation";
import {
  handsFreeSummary,
  prepareHandsFree,
  releaseHandsFree,
} from "./overlay/hands-free";
import { announceHandsFree } from "./overlay/share-handoff";
import type { SessionErrorCode } from "./session-client";
import { tenantFromLocation } from "./session-registry";
import { CREDENTIAL_LIFETIME_TEXT } from "./session-sources";
import { SwitchRow } from "./setup-controls";
import { SetupFooter } from "./setup-footer";
import {
  type BrowserAbilities,
  capabilityLines,
  defaultHost,
  HOST_OPTIONS,
  macStatus,
} from "./setup-hosts";
import {
  buildStartRequest,
  defaultMatrix,
  HOST_SOURCES,
  initialForm,
  newRehearsalRunId,
  type SetupForm,
  type SetupHost,
  startBlocker,
  startErrorMessage,
} from "./setup-model";
import {
  type DeviceOnlyBlocker,
  HostSection,
  LocalityRow,
  MatrixRow,
  RetentionRow,
  ScreenshotSendRow,
  SetupSection,
  TargetSection,
} from "./setup-sections";
import { useCompanionCapability } from "./use-companion-capability";
import { useLiveSession } from "./use-live-session";
import { useSetupChoices } from "./use-setup-choices";
import { Button } from "../../ui";

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
}[] = [
  {
    value: "microphone",
    title: "Microphone",
    description: "Your voice",
  },
  {
    value: "application-audio",
    title: "App audio",
    description: "The other side of the call",
  },
  {
    value: "screen",
    title: "Screen",
    description:
      "Screenshots the companion sends are stored for you. With remote processing, pressing Analyze sends one to the selected vision-capable model; device-only refuses it",
  },
];

const NO_BLOCKERS: readonly DeviceOnlyBlocker[] = [];

// What this browser itself can do, read once per render of Setup.
function browserAbilities(): BrowserAbilities {
  return {
    dictation: recognitionCtor() !== null,
    screenShare:
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getDisplayMedia === "function",
  };
}

// "Start a live session": target, host, sources, assistance, matrix, locality
// and retention. Starting goes through `useLiveSession().actions.start`; once
// the store holds an open session the Live view switches to the live panel by
// itself, where the pairing credential is shown (PairingPanel).
export function SetupView({
  studio,
  deviceOnlyBlockers = NO_BLOCKERS,
}: SetupViewProps) {
  const { actions, snapshot } = useLiveSession();
  const companion = useCompanionCapability();
  const report = companion.status === "ready" ? companion.capability : null;
  const native = studioHostInfo();
  // Only the passed blockers block Start. The stored report is owner-level and
  // a session credential can post one, so it is shown as an advisory; the
  // companion's own on-device check at start is the authority.
  const blockers = deviceOnlyBlockers;
  const advisories = capabilityAdvisories(report);
  const advisoryAge = report ? reportAge(report, Date.now()) : null;
  const { state: choices, reload } = useSetupChoices();
  // The last processing choice, remembered per tenant, is the starting point
  // and is said so on screen until the owner picks again.
  const [remembered] = useState(() =>
    loadHandsFreeChoice(tenantFromLocation()),
  );
  const [policyPicked, setPolicyPicked] = useState(false);
  const [form, setForm] = useState<SetupForm>(() => ({
    ...initialForm(defaultHost(native)),
    policy: remembered ?? initialForm(defaultHost(native)).policy,
  }));
  const [failure, setFailure] = useState<SessionErrorCode | null>(null);
  const matrixTouched = useRef(false);
  // One id per Setup screen, so a retried start names the same rehearsal run.
  const runId = useRef<string | null>(null);
  const pending = snapshot.pending.includes("start");
  // Start takes focus once, the moment it becomes possible, so Enter starts.
  const primary = useRef<HTMLButtonElement>(null);
  const focused = useRef(false);
  const patch = (next: Partial<SetupForm>) => {
    if (next.policy) {
      saveHandsFreeChoice(tenantFromLocation(), next.policy);
      setPolicyPicked(true);
    }
    setForm((current) => ({ ...current, ...next }));
  };
  // Choosing a host sets its default sources; the switches still adjust them.
  const chooseHost = (host: SetupHost) =>
    patch({ host, sources: HOST_SOURCES[host] });

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
  runId.current ??= newRehearsalRunId();
  const request = buildStartRequest(form, runId.current, profiles);
  const blocker = startBlocker(form, blockers[0]?.title ?? null);
  const canStart = request !== null && blocker === null && !pending;
  const host = HOST_OPTIONS.find((option) => option.id === form.host);

  useEffect(() => {
    if (!canStart || focused.current) return;
    focused.current = true;
    primary.current?.focus();
  }, [canStart]);

  async function start() {
    if (!request || !canStart) return;
    setFailure(null);
    // In a browser the click asks for the microphone, before anything is
    // awaited (the browser needs the user gesture). The Mac app captures for
    // itself, so nothing is asked of the browser then.
    const asked =
      form.host === "browser"
        ? prepareHandsFree({ deviceOnly: form.policy === "device-only" })
        : null;
    const outcome = asked ? await asked : null;
    if (outcome) saveAutoPreferred(tenantFromLocation(), true);
    const result = await actions.start(request);
    if (result.ok) {
      if (outcome) announceHandsFree(handsFreeSummary(outcome));
      return;
    }
    if (outcome) releaseHandsFree();
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

  const facts = { native, report, browser: browserAbilities() };
  const sourceTitles = SOURCES.filter((source) =>
    form.sources.includes(source.value),
  ).map((source) => source.title);
  const summary = [
    host?.title,
    sourceTitles.join(", "),
    form.policy === "device-only" ? "Device only" : "Allow remote",
  ].join(" · ");

  return (
    <div className="live-page setup-page" data-testid="live-setup">
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

      <HostSection
        host={form.host}
        onHost={chooseHost}
        macStatus={macStatus(native)}
        lines={{
          mac: capabilityLines("mac", facts),
          browser: capabilityLines("browser", facts),
        }}
      >
        {form.host === "browser" && (
          <div
            role="status"
            className="setup-warning"
            data-testid="browser-warning"
          >
            <Icon name="info" />
            <span>
              A plain browser can’t hear app audio, so questions from the other
              side won’t be answered. Use the Mac app, or pair the capture
              companion after you start.
            </span>
          </div>
        )}
        <p className="setup-muted" data-testid="setup-companion">
          Pairing happens when you start: Studio shows a pairing credential,
          shown once and valid for up to {CREDENTIAL_LIFETIME_TEXT}, for the
          capture companion. Studio can’t tell whether the companion is running
          until it makes contact.
        </p>
        <CompanionReport
          state={companion}
          sources={form.sources}
          showFacts={false}
        />
        <fieldset className="setup-sources">
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
            Only these sources are captured. The companion cannot add sources.
            You can stop it on the Mac at any time, even when Studio is
            unreachable; until you do, it keeps capturing and sends what it
            holds when Studio returns. Source labels aren’t speaker identities,
            and app audio can contain several people.
          </p>
        </fieldset>
      </HostSection>

      <SetupSection id="setup-help" number={3} title="Help and privacy">
        <div className="setup-settings">
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
            {!strict &&
              form.assistance &&
              form.host === "mac" &&
              !form.sources.includes("application-audio") && (
                <div
                  role="status"
                  className="setup-muted setup-reason"
                  data-testid="app-audio-advisory"
                >
                  Questions are read from the other side’s audio (application
                  audio); with the microphone only, no question will be
                  answered.
                </div>
              )}
            {rehearsal && !strict && form.assistance && (
              <div className="setup-muted setup-reason">
                Each draft shown counts as a hint at the usual hint cost.
              </div>
            )}
          </SwitchRow>
          <MatrixRow
            choices={choices}
            value={form.matrix}
            onChange={(matrix) => {
              matrixTouched.current = true;
              patch({ matrix });
            }}
            onOpenBriefings={() => studio.go("briefings")}
          />
          <LocalityRow
            value={form.policy}
            remembered={policyPicked ? null : remembered}
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
          <ScreenshotSendRow
            value={form.screenshotSend}
            deviceOnly={form.policy === "device-only"}
            onChange={(screenshotSend) => patch({ screenshotSend })}
          />
          <RetentionRow
            value={form.retention}
            onChange={(retention) => patch({ retention })}
          />
        </div>
      </SetupSection>

      {failure && (
        <div role="alert" className="setup-error" data-testid="setup-failure">
          <span>{startErrorMessage(failure)}</span>
          {failure === "open_session_exists" && (
            <Button size="lg" onClick={() => void actions.refresh()}>
              Open it
            </Button>
          )}
        </div>
      )}
      <SetupFooter
        blocker={blocker}
        summary={summary}
        note={host?.startNote ?? ""}
        pending={pending}
        onStart={() => void start()}
        startRef={primary}
      />
    </div>
  );
}
