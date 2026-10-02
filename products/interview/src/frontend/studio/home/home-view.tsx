import { formatRelativeTime, formatTimestamp } from "../../format-timestamp";
import type { StudioActions } from "../config/commands";
import { Icon } from "../icon";
import { runStatus } from "../run-status";
import type { StudioLists } from "../use-studio-lists";
import { LANGUAGE_LABELS } from "../workspace/stages";
import { daysUntil, InterviewCard } from "./interview-card";
import { PlanCard } from "./plan-card";
import { usePlan } from "./use-plan";

const CONTINUE_LIMIT = 8;

function greeting(hour: number) {
  return hour < 12
    ? "Good morning"
    : hour < 18
      ? "Good afternoon"
      : "Good evening";
}

// Home: the interview ahead, the plan for it, and what to pick up again.
export function HomeView({
  actions,
  lists,
}: {
  actions: StudioActions;
  lists: StudioLists;
}) {
  const state = usePlan();
  const interview = state.plan?.interview ?? null;
  const items = state.plan?.items ?? [];
  const days = daysUntil(interview?.scheduledAt ?? null);
  const subtitle =
    interview && days !== null && days >= 0
      ? `${days === 0 ? "Today is" : days === 1 ? "Tomorrow is" : `${days} days until`} your ${interview.company} interview. Here’s what’s left.`
      : "Pick up where you left off, or start something new.";
  return (
    <div className="studio-page">
      <div className="studio-page-inner">
        <div className="studio-page-head">
          <div>
            <h1>{greeting(new Date().getHours())}</h1>
            <p>{subtitle}</p>
          </div>
          <button
            type="button"
            className="studio-button"
            onClick={actions.newQuestion}
          >
            <Icon name="add" />
            New question
          </button>
          <button
            type="button"
            className="studio-button primary"
            onClick={() => actions.go("rehearsal")}
          >
            <Icon name="play_arrow" filled />
            Start a rehearsal
          </button>
        </div>

        {state.error && (
          <div className="home-error" role="alert">
            Couldn’t load your plan ({state.error}).{" "}
            <button type="button" onClick={() => void state.reload()}>
              Retry
            </button>
          </div>
        )}
        {state.plan && (
          <div className="home-grid">
            <InterviewCard plan={interview} items={items} state={state} />
            {interview ? (
              <PlanCard
                items={items}
                state={state}
                lists={lists}
                actions={actions}
              />
            ) : (
              <section className="home-card home-plan" aria-label="Prep plan">
                <div className="home-card-head">Prep plan</div>
                <p className="home-muted home-empty">
                  Add the interview you’re preparing for, then plan the work for
                  it.
                </p>
              </section>
            )}
          </div>
        )}

        <section className="studio-section" aria-labelledby="home-continue">
          <h2 id="home-continue">Continue</h2>
          <div className="studio-list">
            {lists.questions.slice(0, CONTINUE_LIMIT).map((question) => {
              const status = runStatus(question);
              return (
                <button
                  key={question.artifactId}
                  type="button"
                  className="studio-list-row home-continue-row"
                  onClick={() => actions.openArtifact(question.artifactId)}
                >
                  <span className="studio-list-title">{question.title}</span>
                  <span className="studio-mono">
                    {question.language
                      ? (LANGUAGE_LABELS[
                          question.language as keyof typeof LANGUAGE_LABELS
                        ] ?? question.language)
                      : "—"}
                  </span>
                  <span className={`home-run ${status.tone}`}>
                    <Icon name={status.icon} size={15} />
                    {status.label}
                  </span>
                  <span
                    className="studio-faint"
                    title={formatTimestamp(question.updatedAt)}
                  >
                    {formatRelativeTime(question.updatedAt)}
                  </span>
                </button>
              );
            })}
            {lists.status === "ready" && !lists.questions.length && (
              <div className="studio-list-empty">
                No questions yet. Start with “New question”.
              </div>
            )}
            {lists.status === "error" && (
              <div className="studio-list-empty" role="alert">
                Couldn’t load your questions.{" "}
                <button type="button" onClick={lists.refresh}>
                  Retry
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
