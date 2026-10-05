// The Transcript tab: what was heard and seen, in order, labelled by capture
// source (a channel, never a speaker identity). Text is plain; a screenshot is
// never drawn here, only offered as a download through the owner's route
// (ADR-0012/screenshots-as-private-artifacts: served as an attachment).
import { Icon } from "../icon";
import { clockLabel } from "./session-format";
import { tenantFromLocation } from "./session-registry";
import {
  NO_LABELS,
  type TranscriptLabels,
  type TranscriptRow,
} from "./session-transcript";
import { noQuestionLines } from "./shared/no-question";
import { selectedRevisionOf } from "./shared/revisions";
import { TASK_KIND } from "./shared/task-kind";
import { taskLabel } from "./shared/task-target";

const MAX_TRANSCRIPT_ROWS = 300;

const GAP_REASON: Record<string, string> = {
  "buffer-overflow": "the capture buffer filled",
  "source-interrupted": "the source was interrupted",
  paused: "the session was paused",
  error: "a capture error",
};
const DISCONNECT_REASON: Record<string, string> = {
  "user-stopped": "stopped on the Mac",
  "permission-revoked": "permission revoked",
  "device-lost": "device lost",
  error: "capture error",
};

function screenshotHref(sessionId: string, artifactId: string): string {
  return `/api/interview/t/${encodeURIComponent(tenantFromLocation())}/sessions/${encodeURIComponent(sessionId)}/screenshots/${encodeURIComponent(artifactId)}`;
}

function Row({
  row,
  sessionId,
  start,
  labels,
  revisionPicks,
}: {
  row: TranscriptRow;
  sessionId: string;
  start: string;
  labels: TranscriptLabels;
  revisionPicks: Readonly<Record<string, number>>;
}) {
  switch (row.type) {
    case "utterance":
      return (
        <li
          className="live-line"
          data-superseded={row.superseded || undefined}
          data-testid="transcript-row"
        >
          <div className="live-line-meta">
            <span className="live-mono">
              {clockLabel(row.receivedAt, start)}
            </span>
            <span className="live-chip neutral">{row.sourceLabel}</span>
            {row.superseded && (
              <span className="live-chip amber">corrected</span>
            )}
            {row.correctsEventId && (
              <span className="live-note">corrects an earlier line</span>
            )}
          </div>
          <p className="live-line-text">{row.text}</p>
        </li>
      );
    case "unreadable":
      return (
        <li className="live-line live-event amber" data-testid="transcript-row">
          <Icon name="warning" />
          <span>
            {clockLabel(row.receivedAt, start)} · A line could not be shown
          </span>
        </li>
      );
    case "screenshot": {
      const shot = labels.snapshot(row);
      return (
        <li className="live-line live-event" data-testid="transcript-row">
          <Icon name="screenshot_monitor" />
          <span>
            Screen · {row.windowLabel} ·{" "}
            {shot ? `${shot} captured` : "snapshot"}
          </span>
          {row.artifactId && (
            <a
              className="live-link"
              href={screenshotHref(sessionId, row.artifactId)}
              download
              rel="noopener"
            >
              Download
            </a>
          )}
        </li>
      );
    }
    case "gap":
      return (
        <li className="live-line live-event amber" data-testid="transcript-row">
          <Icon name="warning" />
          <span>
            {row.sourceLabel}: {Math.round(row.durationMs / 1000)} s not
            captured because {GAP_REASON[row.reason] ?? "of a capture problem"}
          </span>
        </li>
      );
    case "disconnect":
      return (
        <li className="live-line live-event red" data-testid="transcript-row">
          <Icon name="error" />
          <span>
            {row.sourceLabel} disconnected:{" "}
            {DISCONNECT_REASON[row.reason] ?? "capture problem"}
          </span>
        </li>
      );
    case "no-question":
      return (
        <li
          className="live-line live-event live-no-question"
          data-testid="transcript-note"
        >
          <Icon name="visibility_off" />
          <span>
            {clockLabel(row.at, start)} ·{" "}
            {noQuestionLines(
              row.notes.map((note) =>
                note.snapshot ? labels.snapshot(note.snapshot) : null,
              ),
            ).join(" · ")}
          </span>
        </li>
      );
    case "task": {
      const task = taskLabel(row.ordinal);
      const shot = labels.taskSnapshot(row.taskId);
      const revision = selectedRevisionOf(row, revisionPicks);
      const shown = row.revisions.find((each) => each.revision === revision);
      return (
        <li
          className="live-line accent"
          data-testid="transcript-row"
          data-task-row={row.taskId}
        >
          <div className="live-line-meta live-event">
            <Icon name={TASK_KIND[row.kind].icon} />
            <span>
              {shot ? `${shot} analysed → ` : ""}
              {task} started · {TASK_KIND[row.kind].label.toLowerCase()}
            </span>
            {row.revisions.length > 1 && shown && (
              <span className="live-chip neutral" data-testid="task-row-rev">
                rev {revision} of {row.revisions.length} · {shown.cause}
              </span>
            )}
          </div>
          {shown && (
            <p
              className="live-line-text"
              data-testid="task-row-text"
              data-pending={shown.text.text === null || undefined}
            >
              {shown.text.text ?? shown.text.note}
            </p>
          )}
        </li>
      );
    }
  }
}

const keyOf = (row: TranscriptRow): string =>
  row.type === "utterance"
    ? `${row.sourceId}:${row.eventId}`
    : row.type === "task"
      ? `task-${row.taskId}`
      : row.type === "no-question"
        ? `no-question-${row.notes[0]?.taskId}`
        : `${row.type}-${row.sequence}`;

export function TranscriptTab({
  rows,
  sessionId,
  sessionStart,
  labels = NO_LABELS,
  revisionPicks = {},
}: {
  rows: readonly TranscriptRow[];
  sessionId: string;
  sessionStart: string;
  labels?: TranscriptLabels;
  // The older revision of a task the person is viewing; its row shows that
  // revision's text. A task with no entry shows its current one.
  revisionPicks?: Readonly<Record<string, number>>;
}) {
  if (rows.length === 0)
    return (
      <p className="live-empty">
        Transcript lines appear here once the companion finalises them.
      </p>
    );
  const shown = rows.slice(-MAX_TRANSCRIPT_ROWS);
  return (
    <>
      {shown.length < rows.length && (
        <p className="live-note">Showing the latest {shown.length} lines.</p>
      )}
      <ol className="live-lines" aria-label="Transcript">
        {shown.map((row) => (
          <Row
            key={keyOf(row)}
            row={row}
            sessionId={sessionId}
            start={sessionStart}
            labels={labels}
            revisionPicks={revisionPicks}
          />
        ))}
      </ol>
    </>
  );
}
