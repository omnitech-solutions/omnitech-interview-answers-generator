import { Button } from "@oc-tech/omni-ui-components";
import type {
  BriefingContext,
  BriefingPrepared,
  CandidateMatrix,
} from "@omnitech/interview-contracts";
import { useState } from "react";
import { Icon } from "../../icon";
import { copyText } from "../../live/shared/copy-text";

type Tab = "overview" | "stories" | "ask" | "watch";

// The prepared briefing's tabs, as cards. Before it is prepared, a tab
// offers to prepare it.
export function BriefingTab({
  tab,
  prepared,
  context,
  matrix,
  preparing,
  error,
  onPrepare,
  onChange,
  onSeeAnswer,
}: {
  tab: Tab;
  prepared: BriefingPrepared | undefined;
  context: BriefingContext | undefined;
  matrix: CandidateMatrix | null;
  preparing: boolean;
  error: string;
  onPrepare(): void;
  // The person ticked a question or moved a story to another role.
  onChange(prepared: BriefingPrepared): void;
  // Opens the answer whose question matches.
  onSeeAnswer(pattern: RegExp): void;
}) {
  if (!prepared)
    return (
      <div className="bp-card bp-empty">
        {preparing ? (
          <p role="status">
            <span className="bp-spinner" /> Preparing the briefing from your
            matrix and the interview details…
          </p>
        ) : (
          <>
            <p>
              The briefing covers the shape of the call, how to position
              yourself, the stories to reuse, questions to ask and what to
              avoid.
            </p>
            <Button variant="default" onClick={onPrepare}>
              <Icon name="auto_awesome" />
              Prepare the briefing
            </Button>
          </>
        )}
        {error && (
          <p className="bp-error" role="alert">
            <Icon name="error" />
            {error}
          </p>
        )}
      </div>
    );
  return (
    <>
      {tab === "overview" && (
        <Overview
          prepared={prepared}
          context={context}
          onSeeAnswer={onSeeAnswer}
        />
      )}
      {tab === "stories" && (
        <Stories prepared={prepared} matrix={matrix} onChange={onChange} />
      )}
      {tab === "ask" && <AskThem prepared={prepared} onChange={onChange} />}
      {tab === "watch" && <WatchOuts prepared={prepared} />}
      {tab === "overview" && (
        <>
          {prepared.gaps.length > 0 && (
            <ul className="bp-gaps" aria-label="Check before using">
              {prepared.gaps.map((gap) => (
                <li key={gap}>
                  <Icon name="warning" size={15} />
                  {gap}
                </li>
              ))}
            </ul>
          )}
          <div className="bp-row">
            <Button variant="outline" disabled={preparing} onClick={onPrepare}>
              <Icon name="refresh" size={16} />
              {preparing ? "Preparing…" : "Prepare again"}
            </Button>
            {error && (
              <p className="bp-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}

const Chips = ({
  items,
  tone,
}: {
  items: readonly string[];
  tone?: "green";
}) => (
  <div className="bp-chips small">
    {items.map((item) => (
      <span key={item} className={`bp-chip${tone ? ` ${tone}` : ""}`}>
        {item}
      </span>
    ))}
  </div>
);

// Steps joined by arrows; the first is where you are now.
const Steps = ({
  steps,
  current,
}: {
  steps: readonly string[];
  current?: "first";
}) => (
  <div className="bp-steps">
    {steps.map((step, index) => (
      <span key={step} className="bp-step-wrap">
        <span
          className={`bp-step${current && index === 0 ? " current" : ""}${!current && index === 0 ? " lead" : ""}`}
        >
          {step}
        </span>
        {index < steps.length - 1 && <Icon name="arrow_forward" size={16} />}
      </span>
    ))}
  </div>
);

function Overview({
  prepared,
  context,
  onSeeAnswer,
}: {
  prepared: BriefingPrepared;
  context: BriefingContext | undefined;
  onSeeAnswer(pattern: RegExp): void;
}) {
  const minutes = prepared.agenda.reduce((sum, item) => sum + item.minutes, 0);
  const interviewer = context?.interviewer;
  const initials = (interviewer ?? "?")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  let start = 0;
  const agenda = prepared.agenda.map((item) => {
    const from = start;
    start += item.minutes;
    return { ...item, time: `${from}–${start}` };
  });

  return (
    <>
      <div className="bp-card bp-panel">
        <div className="bp-eyebrow">What this call is</div>
        <div className="bp-lead">{prepared.call.summary}</div>
        {prepared.call.detail && (
          <div className="bp-meta">{prepared.call.detail}</div>
        )}
      </div>
      <div className="bp-pair">
        {agenda.length > 0 && (
          <div className="bp-card bp-panel">
            <div className="bp-panel-head">
              <Icon name="schedule" size={17} />
              <span className="bp-grow">Likely shape</span>
              <span className="bp-meta">
                {context?.durationMinutes ?? minutes} min
              </span>
            </div>
            <div className="bp-timeline" aria-hidden="true">
              {agenda.map((item, index) => (
                <span
                  key={item.time}
                  className={index % 2 ? "alt" : undefined}
                  style={{ flex: item.minutes }}
                />
              ))}
            </div>
            <div className="bp-agenda">
              {agenda.map((item) => (
                <div key={item.time}>
                  <span className="bp-mono">{item.time}</span>
                  <span>{item.topic}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {prepared.interviewer && (
          <div className="bp-card bp-panel">
            <div className="bp-person">
              <span className="bp-avatar">{initials}</span>
              <div>
                <strong>{interviewer ?? "Your interviewer"}</strong>
                {context?.interviewerTitle && (
                  <div className="bp-meta">{context.interviewerTitle}</div>
                )}
              </div>
            </div>
            <div className="bp-body">{prepared.interviewer.note}</div>
            {prepared.interviewer.goodToAsk.length > 0 && (
              <div className="bp-stack">
                <span className="bp-faint">
                  Good to ask {interviewer?.split(/\s+/)[0] ?? "them"} about
                </span>
                <Chips items={prepared.interviewer.goodToAsk} />
              </div>
            )}
            {prepared.interviewer.saveForLater && (
              <div className="bp-note">
                <Icon name="arrow_forward" size={16} />
                {prepared.interviewer.saveForLater}
              </div>
            )}
          </div>
        )}
      </div>
      {prepared.positioning.steps.length > 0 && (
        <div className="bp-card bp-panel">
          <div className="bp-eyebrow">Your story, in order</div>
          <Steps steps={prepared.positioning.steps} />
          {prepared.positioning.note && (
            <div className="bp-meta">{prepared.positioning.note}</div>
          )}
        </div>
      )}
      {(prepared.fit.strong.length > 0 || prepared.fit.watch.length > 0) && (
        <div className="bp-card bp-panel bp-split">
          <div className="bp-stack">
            <div className="bp-panel-head">
              <Icon name="verified" size={17} />
              <span>Strong match with the posting</span>
            </div>
            <Chips items={prepared.fit.strong} tone="green" />
          </div>
          <div className="bp-stack">
            <div className="bp-panel-head caution">
              <Icon name="help" size={17} />
              <span>Be ready on</span>
            </div>
            {prepared.fit.watch.map((item) => (
              <div key={item.topic} className="bp-watch-line">
                <strong>{item.topic}</strong>
                <span>{item.answer}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {prepared.teams.length > 0 && (
        <div className="bp-pair">
          {prepared.teams.map((team) => (
            <div key={team.name} className="bp-card bp-panel">
              <div className="bp-panel-head">
                <Icon name="work" size={17} />
                <span>{team.name}</span>
              </div>
              <Chips items={team.owns} />
              <div className="bp-meta">
                <strong>Likely means:</strong> {team.means}
              </div>
            </div>
          ))}
        </div>
      )}
      {prepared.compensation && (
        <div className="bp-card bp-panel bp-callout">
          <Icon name="payments" size={20} />
          <div className="bp-stack">
            <strong>{prepared.compensation.summary}</strong>
            <span className="bp-body">{prepared.compensation.advice}</span>
            <button
              type="button"
              className="bp-link"
              onClick={() => onSeeAnswer(/salary|compensation|pay/i)}
            >
              See the salary answer
            </button>
          </div>
        </div>
      )}
      {prepared.pipeline && (
        <div className="bp-card bp-panel">
          <strong>After this call</strong>
          <Steps steps={prepared.pipeline.stages} current="first" />
          {prepared.pipeline.later.length > 0 && (
            <div className="bp-stack">
              <span className="bp-faint">Prepare later for</span>
              <Chips items={prepared.pipeline.later} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Stories({
  prepared,
  matrix,
  onChange,
}: {
  prepared: BriefingPrepared;
  matrix: CandidateMatrix | null;
  onChange(prepared: BriefingPrepared): void;
}) {
  return (
    <>
      <p className="bp-intro">
        You don’t need 20 prepared answers. These real stories cover most of
        what this role can ask, so reuse them. Each one comes from a role in
        your matrix.
      </p>
      {prepared.stories.map((story, index) => {
        const role = story.roleId
          ? matrix?.roles[Number(story.roleId.split("/")[2])]
          : undefined;
        return (
          <div key={story.title} className="bp-card bp-story">
            <span className="bp-number">{index + 1}</span>
            <div className="bp-stack bp-grow">
              <strong>{story.title}</strong>
              <span className="bp-mono plain">{story.shape}</span>
              <span className="bp-faint">
                Covers: {story.covers.join(", ")}
              </span>
            </div>
            <div className="bp-field bp-story-role">
              From your matrix
              <select
                aria-label={`Role for ${story.title}`}
                value={story.roleId ?? ""}
                onChange={(event) =>
                  onChange({
                    ...prepared,
                    stories: prepared.stories.map((item, at) => {
                      if (at !== index) return item;
                      const { roleId: _previous, ...rest } = item;
                      return event.target.value
                        ? { ...rest, roleId: event.target.value }
                        : rest;
                    }),
                  })
                }
              >
                <option value="">Choose a role</option>
                {matrix?.roles.map((item, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the items carry no id and repeat, and the list is rebuilt whole from its source in a fixed order, never reordered
                  <option key={`/roles/${at}`} value={`/roles/${at}`}>
                    {item.company} · {item.title}
                  </option>
                ))}
              </select>
              {role?.period && <span>{role.period}</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}

function AskThem({
  prepared,
  onChange,
}: {
  prepared: BriefingPrepared;
  onChange(prepared: BriefingPrepared): void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <>
      {prepared.ask.map((group, groupIndex) => (
        <div key={group.title} className="bp-stack">
          <div className="bp-group-head">
            <strong>{group.title}</strong>
            {group.note && <span className="bp-meta">{group.note}</span>}
          </div>
          <div className="bp-card bp-list">
            {group.items.map((item, itemIndex) => (
              <div
                key={item.question}
                className={`bp-ask-item${item.asked ? " asked" : ""}`}
              >
                <input
                  type="checkbox"
                  aria-label={`Asked: ${item.question}`}
                  checked={Boolean(item.asked)}
                  onChange={(event) =>
                    onChange({
                      ...prepared,
                      ask: prepared.ask.map((each, at) =>
                        at !== groupIndex
                          ? each
                          : {
                              ...each,
                              items: each.items.map((entry, index) =>
                                index === itemIndex
                                  ? { ...entry, asked: event.target.checked }
                                  : entry,
                              ),
                            },
                      ),
                    })
                  }
                />
                <div className="bp-stack bp-grow">
                  <q>{item.question}</q>
                  <span className="bp-meta">{item.why}</span>
                </div>
                <button
                  type="button"
                  className="studio-icon-button"
                  aria-label={`Copy: ${item.question}`}
                  title={copied === item.question ? "Copied" : "Copy"}
                  onClick={() => {
                    void copyText(item.question).then((written) => {
                      if (written) setCopied(item.question);
                    });
                  }}
                >
                  <Icon
                    name={copied === item.question ? "check" : "content_copy"}
                    size={16}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function WatchOuts({ prepared }: { prepared: BriefingPrepared }) {
  return (
    <>
      {prepared.watchOuts.map((item) => (
        <div key={item.title} className="bp-card bp-watch">
          <span className={`bp-tile small ${item.kind}`}>
            <Icon
              name={item.kind === "avoid" ? "close" : "warning"}
              size={17}
            />
          </span>
          <div className="bp-stack bp-grow">
            <strong>{item.title}</strong>
            <span className="bp-body muted">{item.detail}</span>
            {item.sayInstead && (
              <div className="bp-say">
                <span className="bp-eyebrow">Say instead</span>
                <q>{item.sayInstead}</q>
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
