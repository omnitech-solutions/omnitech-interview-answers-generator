// The ended view: what a finished session left behind, truthfully.
//   - Ending revokes the credential and cancels running work (ADR-0012
//     rule:credential-revocation; ADR-0011 rule:pause-end-suppression); the view makes no "nothing is running" claim, as
//     the worker may still be finishing a cancelled job.
//   - "Nothing was submitted or sent for you": no route of this product
//     operates an external interview interface, and the session sends nothing.
//   - A session being deleted, or deleted, holds no content here: the store
//     clears observations and actions while purging, and this view then shows
//     only the tombstone's content-free facts (rule:complete-purge-except-retained-drafts,
//     rule:tombstone-keeps-hint-count).
import type { LiveSessionView } from "@omnitech/interview-contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioActions } from "../config/commands";
import { Icon } from "../icon";
import { SessionHistory } from "./ended-history";
import { EndedResults } from "./ended-results";
import { EndedRetention } from "./ended-retention";
import {
  answerRows,
  codingRows,
  DRAFTS_KEPT,
  formatDayTime,
  type TargetChoices,
  targetTitle,
  withheldNotice,
} from "./ended-summary";
import { createSessionClient } from "./session-client";
import { tenantFromLocation } from "./session-registry";
import type { LiveStats } from "./session-state";
import { useLiveSession } from "./use-live-session";
import { Button } from "../../ui";

export type EndedViewProps = {
  // Studio navigation, for opening the session draft and the Live view.
  studio: StudioActions;
};

// The setup choices name the agreed target; the session record has ids only.
// Read once per session, best effort: without them the title says the kind.
function useTargetChoices(wanted: boolean): TargetChoices | null {
  const [choices, setChoices] = useState<TargetChoices | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    createSessionClient(tenantFromLocation())
      .choices()
      .then((value) => {
        if (!cancelled) setChoices(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [wanted]);
  return choices;
}

function statCells(
  stats: LiveStats,
  session: LiveSessionView,
): { label: string; value: number }[] {
  const cells = [
    { label: "Utterances", value: stats.utterances },
    { label: "Screenshots", value: stats.screenshots },
    { label: "Capture gaps", value: stats.gaps },
    { label: "Tasks", value: stats.tasks },
    { label: "Answers published", value: stats.answersPublished },
    { label: "Code drafts", value: stats.codeDraftsPublished },
  ];
  // Each shown draft of a non-strict rehearsal is a hint on its scorecard
  // (ADR-0012/assistance-counts-as-hints).
  if (session.rehearsalRunId && !session.strict)
    cells.push({ label: "Hints counted", value: stats.hintsCounted });
  return cells;
}

export function EndedView({ studio }: EndedViewProps) {
  const { snapshot, actions, model } = useLiveSession();
  const { session } = snapshot;
  const choices = useTargetChoices(
    session !== null && session.candidacyId !== null && !session.purged,
  );
  // [SAFETY] The session bar unmounts when the session ends, so focus would
  // fall to the page: it moves to the heading, unless the owner has already put
  // it somewhere on purpose.
  const heading = useRef<HTMLHeadingElement>(null);
  const arrived = session !== null;
  useEffect(() => {
    const active = document.activeElement;
    if (arrived && (!active || active === document.body))
      heading.current?.focus();
  }, [arrived]);
  const answers = useMemo(() => answerRows(model.tasks), [model.tasks]);
  const withheld = useMemo(
    () => withheldNotice(snapshot.actions),
    [snapshot.actions],
  );
  if (!session) return null;

  const contentGone = session.purged || session.status === "purging";
  const coding = codingRows(model.tasks, session.workspaceDraft !== null);

  return (
    <div className="live-page" data-testid="live-ended">
      <div className="ended">
        <header className="ended-head">
          <Icon name="stop_circle" />
          <h2 ref={heading} tabIndex={-1}>
            {`Session ended · ${model.elapsedLabel}`}
          </h2>
          {!session.purged && (
            <p className="ended-target">{targetTitle(session, choices)}</p>
          )}
          <p className="live-note">
            Studio no longer accepts capture, and any result that arrives now is
            discarded. Nothing was submitted or sent for you.
          </p>
          {session.rehearsalRunId && session.strict && (
            <p className="live-note">
              Strict rehearsal: live assistance was off, so no hints were
              counted.
            </p>
          )}
        </header>

        {contentGone ? (
          <section
            className="ended-tombstone"
            aria-labelledby="ended-tombstone-title"
            data-testid="ended-tombstone"
          >
            <h3 id="ended-tombstone-title" className="ended-heading">
              {session.purged
                ? "Session data deleted"
                : "Deleting session data"}
            </h3>
            <p className="live-note">
              {session.purged
                ? `The transcript, screenshots and unedited, unreferenced session Workspace drafts are gone. ${DRAFTS_KEPT}`
                : `The transcript, screenshots and session Workspace drafts are no longer shown here while deletion runs. ${DRAFTS_KEPT}`}
            </p>
            <dl className="ended-facts">
              <div>
                <dt>Started</dt>
                <dd>{formatDayTime(session.createdAt)}</dd>
              </div>
              {session.endedAt && (
                <div>
                  <dt>Ended</dt>
                  <dd>{formatDayTime(session.endedAt)}</dd>
                </div>
              )}
              {session.rehearsalRunId && !session.strict && (
                <div>
                  <dt>Hints counted</dt>
                  <dd>{session.shownDraftCount}</dd>
                </div>
              )}
            </dl>
          </section>
        ) : (
          <>
            <dl className="ended-stats" data-testid="ended-stats">
              {statCells(model.stats, session).map((cell) => (
                <div key={cell.label} className="ended-stat">
                  <dt>{cell.label}</dt>
                  <dd>{cell.value}</dd>
                </div>
              ))}
            </dl>
            <EndedResults
              session={session}
              answers={answers}
              withheld={withheld}
              coding={coding}
            />
          </>
        )}

        <EndedRetention
          session={session}
          deleting={snapshot.pending.includes("delete")}
          shorten={actions.shortenRetention}
          remove={actions.deleteSession}
        />

        <div className="ended-footer">
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              actions.dismissFinished();
              studio.go("live");
            }}
          >
            <Icon name="add" />
            Start another session
          </Button>
          <SessionHistory studio={studio} />
        </div>
      </div>
    </div>
  );
}

// An address (live/<id>) the server does not know: say so and offer a way on.
export function SessionNotFound({ studio }: EndedViewProps) {
  const { actions } = useLiveSession();
  return (
    <div className="live-page" data-testid="live-not-found">
      <div className="ended">
        <header className="ended-head">
          <Icon name="search_off" />
          <h2>Session not found</h2>
          <p className="live-note" role="status">
            Studio has no session at this address. It may have been deleted, or
            it may not be yours to open.
          </p>
        </header>
        <div className="ended-footer">
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              actions.dismissFinished();
              studio.go("live");
            }}
          >
            <Icon name="add" />
            Start a session
          </Button>
          <SessionHistory studio={studio} />
        </div>
      </div>
    </div>
  );
}
