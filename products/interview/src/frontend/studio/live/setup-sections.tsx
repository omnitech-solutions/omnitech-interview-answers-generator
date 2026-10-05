// The Setup view's sections: 1 what the session is for, 2 how Studio hears and
// sees (host cards), 3 help and privacy (matrix, where AI runs, retention).
import type {
  LiveProcessingPolicy,
  LiveRetentionMode,
  LiveSessionChoicesResponse,
} from "@omnitech/interview-contracts";
import type { ReactNode } from "react";
import { Icon, type IconName } from "../icon";
import { RETENTION_LABEL, RETENTION_MODES } from "./ended-summary";
import { CardOption, Segmented, SettingRow } from "./setup-controls";
import {
  type CapabilityLine,
  HOST_OPTIONS,
  type LineState,
} from "./setup-hosts";
import { matrixOptions, type SetupHost, type SetupTarget } from "./setup-model";
import type { SetupChoices } from "./use-setup-choices";

// A numbered section with its heading; `id` names it for the controls inside.
export function SetupSection({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="setup-section" aria-labelledby={id}>
      <h3 id={id}>
        {number} · {title}
      </h3>
      {children}
    </section>
  );
}

type Candidacy = LiveSessionChoicesResponse["candidacies"][number];

const targetKey = (target: SetupTarget | null): string =>
  !target
    ? ""
    : target.kind === "rehearsal"
      ? "rehearsal"
      : target.kind === "interview"
        ? `i:${target.interviewId}`
        : `c:${target.candidacyId}`;

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

type TargetOption = {
  target: SetupTarget;
  icon: IconName;
  title: string;
  sub: string;
};

function optionsFor(candidacy: Candidacy): TargetOption[] {
  const where = `${candidacy.title} · ${candidacy.companyName}`;
  if (candidacy.interviews.length === 0)
    return [
      {
        target: { kind: "candidacy", candidacyId: candidacy.id },
        icon: "work",
        title: candidacy.title,
        sub: candidacy.companyName,
      },
    ];
  return candidacy.interviews.map((interview) => ({
    target: {
      kind: "interview",
      candidacyId: candidacy.id,
      interviewId: interview.id,
    },
    icon: "work",
    title: interview.label,
    sub: [where, interview.kind, dateLabel(interview.scheduledAt)]
      .filter(Boolean)
      .join(" · "),
  }));
}

const REHEARSAL: TargetOption = {
  target: { kind: "rehearsal" },
  icon: "timer",
  title: "Rehearsal",
  sub: "Practice with no interview attached",
};

export function TargetSection({
  choices,
  reload,
  target,
  strict,
  onTarget,
  onStrict,
}: {
  choices: SetupChoices;
  reload(): void;
  target: SetupTarget | null;
  strict: boolean;
  onTarget(target: SetupTarget): void;
  onStrict(strict: boolean): void;
}) {
  const options: TargetOption[] = [
    REHEARSAL,
    ...(choices.status === "ready"
      ? choices.choices.candidacies.flatMap(optionsFor)
      : []),
  ];
  const selected = targetKey(target);
  return (
    <SetupSection id="setup-target" number={1} title="What it’s for">
      <div
        role="radiogroup"
        aria-labelledby="setup-target"
        aria-busy={choices.status === "loading"}
        className="setup-cards"
      >
        {options.map((option) => {
          const key = targetKey(option.target);
          return (
            <CardOption
              key={key}
              name="setup-target"
              checked={key === selected}
              onSelect={() => onTarget(option.target)}
              icon={option.icon}
              title={option.title}
              sub={option.sub}
            />
          );
        })}
      </div>
      {choices.status === "loading" && (
        <p className="setup-muted">Loading your interviews…</p>
      )}
      {choices.status === "error" && (
        <p className="setup-muted" role="alert">
          Couldn’t load your interviews. A rehearsal can still start.{" "}
          <button type="button" className="setup-link" onClick={reload}>
            Try again
          </button>
        </p>
      )}
      {choices.status === "ready" &&
        choices.choices.candidacies.length === 0 && (
          <p className="setup-muted">
            No interviews to link yet. You can still start a rehearsal.
          </p>
        )}
      {target?.kind === "rehearsal" && (
        <p className="setup-muted">
          A rehearsal links no interview and never writes a scorecard itself;
          the Rehearsal flow stays the only place that does.
        </p>
      )}
      {target?.kind === "rehearsal" && (
        <label className="setup-inline">
          <input
            type="checkbox"
            checked={strict}
            onChange={(event) => onStrict(event.target.checked)}
          />
          <span>
            <strong>Strict rehearsal</strong> · live assistance stays off, like
            the real thing.
          </span>
        </label>
      )}
    </SetupSection>
  );
}

const LINE_ICON: Record<LineState, IconName> = {
  ok: "check_circle",
  no: "cancel",
  unknown: "help",
};
const LINE_WORD: Record<LineState, string> = {
  ok: "Yes",
  no: "No",
  unknown: "Not known",
};

// The two host cards. Each line's state is real data (setup-hosts.ts); the
// card does not decide what is true.
export function HostSection({
  host,
  onHost,
  lines,
  macStatus,
  children,
}: {
  host: SetupHost;
  onHost(host: SetupHost): void;
  lines: Record<SetupHost, readonly CapabilityLine[]>;
  macStatus: { text: string; state: LineState };
  // Below the cards: the browser warning, pairing note and companion report.
  children?: ReactNode;
}) {
  return (
    <SetupSection id="setup-host" number={2} title="How Studio hears and sees">
      <div
        role="radiogroup"
        aria-labelledby="setup-host"
        className="setup-cards"
      >
        {HOST_OPTIONS.map((option) => (
          <CardOption
            key={option.id}
            name="setup-host"
            checked={option.id === host}
            onSelect={() => onHost(option.id)}
            icon={option.icon}
            title={option.title}
            status={
              option.id === "mac" && (
                <span
                  className="setup-status"
                  data-state={macStatus.state}
                  data-testid="host-status-mac"
                >
                  {macStatus.text}
                </span>
              )
            }
          >
            <ul className="setup-lines" data-testid={`host-lines-${option.id}`}>
              {lines[option.id].map((line) => (
                <li key={line.id} data-state={line.state}>
                  <Icon name={LINE_ICON[line.state]} />
                  <span className="setup-sr">{LINE_WORD[line.state]}: </span>
                  {line.text}
                </li>
              ))}
            </ul>
          </CardOption>
        ))}
      </div>
      {children}
    </SetupSection>
  );
}

export function MatrixRow({
  choices,
  value,
  onChange,
  onOpenBriefings,
}: {
  choices: SetupChoices;
  value: string;
  onChange(value: string): void;
  onOpenBriefings(): void;
}) {
  const profiles = choices.status === "ready" ? choices.choices.profiles : [];
  if (profiles.length > 0)
    return (
      <SettingRow
        icon="badge"
        title="Experience matrix"
        note="Answers can only claim what it says. Pinned for the whole session."
        control={
          <select
            aria-label="Matrix and revision"
            className="setup-select"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            {matrixOptions(profiles).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value="none">No matrix</option>
          </select>
        }
      />
    );
  const loading = choices.status === "loading";
  return (
    <SettingRow
      icon="badge"
      title="Experience matrix"
      note={
        loading
          ? "Loading your matrices…"
          : "You have no experience matrix yet. You can still start: with no matrix, answers can’t claim your experience."
      }
      control={
        loading ? null : (
          <button
            type="button"
            className="setup-link"
            onClick={onOpenBriefings}
          >
            Import one in Briefings
          </button>
        )
      }
    />
  );
}

const POLICY_COPY: Record<LiveProcessingPolicy, string> = {
  "device-only":
    "Only on-device models read your content. Any step with no on-device model, such as solving code, is refused and never sent elsewhere; the live session shows each refusal.",
  "permitted-remote":
    "Remote models may be used for answers and code. Speech recognition still runs on this Mac.",
};

const POLICY_ICON: Record<LiveProcessingPolicy, IconName> = {
  "device-only": "lock",
  "permitted-remote": "cloud",
};

const POLICY_LABEL: Record<LiveProcessingPolicy, string> = {
  "device-only": "Device only",
  "permitted-remote": "Allow remote",
};

const LOCALITY_OPTIONS = (["permitted-remote", "device-only"] as const).map(
  (value) => ({ value, label: POLICY_LABEL[value] }),
);

export type DeviceOnlyBlocker = { title: string; body: string };

export function LocalityRow({
  value,
  remembered,
  blockers,
  advisories = [],
  advisoryAge = null,
  speechWarning = false,
  onChange,
}: {
  value: LiveProcessingPolicy;
  // The choice carried over from last time, while the owner has not touched it
  // on this screen; null otherwise.
  remembered: LiveProcessingPolicy | null;
  // Reasons that block Start in device-only mode.
  blockers: readonly DeviceOnlyBlocker[];
  // From the companion's stored report: shown, never blocking, because the
  // report is owner-level and the companion's own check is the authority.
  advisories?: readonly DeviceOnlyBlocker[];
  advisoryAge?: string | null;
  // The companion's last report says speech can't run here, and the policy
  // would not block Start: say that allowing remote does not fix speech.
  speechWarning?: boolean;
  onChange(value: LiveProcessingPolicy): void;
}) {
  return (
    <SettingRow
      icon={POLICY_ICON[value]}
      title="Where AI runs"
      note={POLICY_COPY[value]}
      control={
        <Segmented
          label="Where AI runs"
          value={value}
          onChange={onChange}
          options={LOCALITY_OPTIONS}
        />
      }
    >
      {remembered && (
        <p className="setup-muted" data-testid="remembered-policy">
          Remembered from your last choice: {POLICY_LABEL[remembered]}. Change
          it here before you start.
        </p>
      )}
      {value === "device-only" && (
        <div
          role="status"
          className="setup-warning"
          data-testid="device-only-warning"
        >
          <Icon name="warning" />
          <span>
            Device only: no screenshot analysis, no code generation, dictation
            only if your browser or Mac has on-device speech. Screenshots are
            still stored for you, never sent to a model.
          </span>
        </div>
      )}
      {value === "device-only" &&
        blockers.map((blocker) => (
          <div key={blocker.title} role="alert" className="setup-blocker">
            <Icon name="error" />
            <div>
              <strong>{blocker.title}</strong>
              <div>{blocker.body}</div>
            </div>
          </div>
        ))}
      {value === "device-only" &&
        advisories.map((advisory) => (
          <div
            key={advisory.title}
            role="status"
            className="setup-muted"
            data-testid="capability-advisory"
          >
            <strong>{advisory.title}</strong>
            <div>{advisory.body}</div>
            {advisoryAge && (
              <div>
                This is the companion’s last report, {advisoryAge}. It doesn’t
                block Start.
              </div>
            )}
          </div>
        ))}
      {speechWarning && value === "permitted-remote" && (
        <p className="setup-muted" data-testid="speech-warning">
          The companion’s last report says speech recognition can’t run on this
          Mac. Allowing remote processing doesn’t change that: the companion
          recognises speech on this Mac, so it will report it and stop.
        </p>
      )}
      <p className="setup-muted">
        After the session starts you can only tighten this, never loosen it.
      </p>
    </SettingRow>
  );
}

const RETENTION_COPY: Record<LiveRetentionMode, string> = {
  "delete-at-end":
    "Session records are deleted shortly after you end the session, when the worker’s purge runs. Edited or revision-linked Workspace drafts may remain; delete them separately in Workspace.",
  "thirty-days":
    "Session records are deleted 30 days after the session ends. Edited or revision-linked Workspace drafts may remain; delete them separately in Workspace.",
  "until-deleted":
    "Session records are kept until you delete them. Until then they block deleting the interview, candidacy or matrix revision they link. Edited or revision-linked Workspace drafts may remain; delete them separately in Workspace.",
};

const RETENTION_OPTIONS = RETENTION_MODES.map((mode) => ({
  value: mode,
  label: RETENTION_LABEL[mode],
}));

export function RetentionRow({
  value,
  onChange,
}: {
  value: LiveRetentionMode;
  onChange(value: LiveRetentionMode): void;
}) {
  return (
    <SettingRow
      icon="schedule"
      title="Keep transcript and screenshots"
      note="Private to you · raw audio is never saved · can only be shortened later"
      control={
        <Segmented
          label="Keep the session"
          value={value}
          onChange={onChange}
          options={RETENTION_OPTIONS}
        />
      }
    >
      <p className="setup-muted">{RETENTION_COPY[value]}</p>
      <dl className="setup-facts">
        <div>
          <dt>Kept</dt>
          <dd>Transcript and the screenshots the companion sends</dd>
        </div>
        <div>
          <dt>Visibility</dt>
          <dd>Private to you, not added to the matrix or exercise catalogue</dd>
        </div>
        <div>
          <dt>Raw audio</dt>
          <dd>Memory only, never saved</dd>
        </div>
      </dl>
    </SettingRow>
  );
}
