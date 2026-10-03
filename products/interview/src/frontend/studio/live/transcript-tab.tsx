// The Transcript tab: what was heard and seen, in order, labelled by capture
// source (a channel, never a speaker identity). Text is plain; a screenshot is
// never drawn here, only offered as a download through the owner's route
// (ADR-0012/screenshots-as-private-artifacts: served as an attachment).
import { Icon } from "../icon";
import { clockLabel } from "./session-format";
import { tenantFromLocation } from "./session-registry";
import type { TranscriptRow } from "./session-transcript";
import { TASK_KIND } from "./task-panels";

export const MAX_TRANSCRIPT_ROWS = 300;

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

export function screenshotHref(sessionId: string, artifactId: string): string {
  return `/api/interview/t/${encodeURIComponent(tenantFromLocation())}/sessions/${encodeURIComponent(sessionId)}/screenshots/${encodeURIComponent(artifactId)}`;
}

function Row({
  row,
  sessionId,
  start,
}: {
  row: TranscriptRow;
  sessionId: string;
  start: string;
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
    case "screenshot":
      return (
        <li className="live-line live-event" data-testid="transcript-row">
          <Icon name="screenshot_monitor" />
          <span>Screen · {row.windowLabel} · snapshot</span>
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
    case "new-task":
      return (
        <li
          className="live-line live-event accent"
          data-testid="transcript-row"
        >
          <Icon name={TASK_KIND[row.kind].icon} />
          <span>
            {row.revised
              ? `Task revised · rev ${row.revision}`
              : `New task: ${TASK_KIND[row.kind].label.toLowerCase()}`}
          </span>
        </li>
      );
  }
}

const keyOf = (row: TranscriptRow): string =>
  row.type === "utterance"
    ? row.eventId
    : row.type === "new-task"
      ? `task-${row.taskId}-${row.revision}`
      : `${row.type}-${row.sequence}`;

export function TranscriptTab({
  rows,
  sessionId,
  sessionStart,
}: {
  rows: readonly TranscriptRow[];
  sessionId: string;
  sessionStart: string;
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
          />
        ))}
      </ol>
    </>
  );
}
