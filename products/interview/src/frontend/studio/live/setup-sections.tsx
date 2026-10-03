// The Setup view's choice sections: what the session is for, which matrix it
// pins, where processing runs and how long it is kept.
import type {
  LiveProcessingPolicy,
  LiveRetentionMode,
  LiveSessionChoicesResponse,
} from "@omnitech/interview-contracts";
import { Icon } from "../icon";
import { RETENTION_LABEL, RETENTION_MODES } from "./ended-summary";
import { Segmented } from "./setup-controls";
import { matrixOptions, type SetupTarget } from "./setup-model";
import type { SetupChoices } from "./use-setup-choices";

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

type Card = {
  target: SetupTarget;
  title: string;
  sub: string;
};

function cardsFor(candidacy: Candidacy): Card[] {
  const where = `${candidacy.title} · ${candidacy.companyName}`;
  if (candidacy.interviews.length === 0)
    return [
      {
        target: { kind: "candidacy", candidacyId: candidacy.id },
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
    title: interview.label,
    sub: [where, interview.kind, dateLabel(interview.scheduledAt)]
      .filter(Boolean)
      .join(" · "),
  }));
}

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
  const cards: Card[] = [
    {
      target: { kind: "rehearsal" },
      title: "Rehearsal",
      sub: "Practice with no interview attached",
    },
    ...(choices.status === "ready"
      ? choices.choices.candidacies.flatMap(cardsFor)
      : []),
  ];
  const selected = targetKey(target);
  return (
    <fieldset
      className="setup-section"
      aria-busy={choices.status === "loading"}
    >
      <legend>What is this session for?</legend>
      <div className="setup-cards">
        {cards.map((card) => {
          const key = targetKey(card.target);
          return (
            <label
              key={key}
              className={`setup-card${key === selected ? " on" : ""}`}
            >
              <input
                type="radio"
                name="setup-target"
                checked={key === selected}
                onChange={() => onTarget(card.target)}
              />
              <span className="setup-card-title">{card.title}</span>
              <span className="setup-muted">{card.sub}</span>
            </label>
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
    </fieldset>
  );
}

export function MatrixSection({
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
  return (
    <section className="setup-section">
      <h3>Experience matrix</h3>
      {profiles.length > 0 ? (
        <>
          <label className="setup-field">
            <span className="setup-muted">Matrix and revision</span>
            <select
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
          </label>
          <p className="setup-muted">
            Pinned for the whole session. Answers can only claim what it says.
          </p>
        </>
      ) : (
        <p className="setup-muted">
          {choices.status === "loading"
            ? "Loading your matrices…"
            : "You have no experience matrix yet. You can still start: with no matrix, answers can’t claim your experience."}{" "}
          {choices.status !== "loading" && (
            <button
              type="button"
              className="setup-link"
              onClick={onOpenBriefings}
            >
              Import one in Briefings
            </button>
          )}
        </p>
      )}
    </section>
  );
}

const POLICY_COPY: Record<LiveProcessingPolicy, string> = {
  "device-only":
    "Only on-device models read your content. Any step with no on-device model, such as solving code, is refused and never sent elsewhere; the live session shows each refusal.",
  "permitted-remote":
    "Remote models may be used for answers and code. Speech recognition still runs on this Mac.",
};

export type DeviceOnlyBlocker = { title: string; body: string };

export function ProcessingSection({
  value,
  blockers,
  onChange,
}: {
  value: LiveProcessingPolicy;
  blockers: readonly DeviceOnlyBlocker[];
  onChange(value: LiveProcessingPolicy): void;
}) {
  return (
    <section className="setup-section">
      <h3 id="setup-processing">Where processing runs</h3>
      <Segmented
        label="Where processing runs"
        value={value}
        onChange={onChange}
        options={[
          { value: "device-only", label: "Device only" },
          { value: "permitted-remote", label: "Allow remote" },
        ]}
      />
      <p className="setup-muted">{POLICY_COPY[value]}</p>
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
      <p className="setup-muted">
        After the session starts you can only tighten this, never loosen it.
      </p>
    </section>
  );
}

const RETENTION_COPY: Record<LiveRetentionMode, string> = {
  "delete-at-end": "Session data is deleted when you end the session.",
  "thirty-days": "Session data is deleted 30 days after the session ends.",
  "until-deleted":
    "Kept until you delete it. Until then it blocks deleting the interview, candidacy or matrix revision it links.",
};

export function RetentionSection({
  value,
  onChange,
}: {
  value: LiveRetentionMode;
  onChange(value: LiveRetentionMode): void;
}) {
  return (
    <section className="setup-section">
      <h3>Keep the session</h3>
      <Segmented
        label="Keep the session"
        value={value}
        onChange={onChange}
        options={[
          ...RETENTION_MODES.map((mode) => ({
            value: mode,
            label: RETENTION_LABEL[mode],
          })),
        ]}
      />
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
      <p className="setup-muted">
        You can shorten this later, never lengthen it.
      </p>
    </section>
  );
}
