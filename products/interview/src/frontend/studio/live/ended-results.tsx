// The results list of a finished session: answer drafts, the Workspace draft
// and the fixed statement that nothing was promoted. Every draft is rendered as
// plain text (rule:inert-draft-rendering): no Markdown, no HTML, no links.
import { useState } from "react";
import { Icon } from "../icon";
import {
  type AnswerRow,
  type CodingRow,
  type WithheldNotice,
} from "./ended-summary";
import { useSessionDraftLink } from "./workspace-handoff";
import type { LiveSessionView } from "@omnitech/interview-contracts";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="studio-button"
      aria-label={copied ? `${label}: copied` : label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <Icon name={copied ? "check" : "content_copy"} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function AnswerResult({ row }: { row: AnswerRow }) {
  return (
    <li className="ended-result" data-testid="ended-answer">
      <Icon name="psychology" />
      <div className="ended-result-body">
        <div className="ended-result-title">{row.title}</div>
        <div className="live-note">
          {row.claims}
          {row.stale ? " · for an earlier version of the question" : ""}
        </div>
        <details className="ended-draft">
          <summary>Show draft</summary>
          <p className="ended-draft-text">{row.draft}</p>
        </details>
      </div>
      <CopyButton text={row.draft} label={`Copy ${row.title}`} />
    </li>
  );
}

function WithheldResult({ notice }: { notice: WithheldNotice }) {
  const drafts =
    notice.drafts === 1
      ? "1 answer draft was withheld"
      : `${notice.drafts} answer drafts were withheld`;
  const claims =
    notice.claims === null
      ? ""
      : notice.claims === 1
        ? " · 1 claim failed checking"
        : ` · ${notice.claims} claims failed checking`;
  return (
    <li className="ended-result" data-testid="ended-withheld">
      <Icon name="warning" />
      <div className="ended-result-body">
        <div className="ended-result-title">{`${drafts}${claims}`}</div>
        <div className="live-note">
          A claim could not be checked against your approved experience, so
          nothing was published.
        </div>
      </div>
    </li>
  );
}

function CodingResult({
  row,
  session,
}: {
  row: CodingRow;
  session: Pick<LiveSessionView, "id" | "workspaceDraft">;
}) {
  const link = useSessionDraftLink(session, row.taskId || undefined);
  return (
    <li className="ended-result" data-testid="ended-coding">
      <Icon name="code" />
      <div className="ended-result-body">
        <div className="ended-result-title">{row.title}</div>
        <div className="live-note">
          {row.summary}
          {row.stale ? " · for an earlier version of the task" : ""}
        </div>
        {row.held && (
          <div className="live-note">
            A newer solution was held because you edited the draft.
          </div>
        )}
      </div>
      {row.hasDraft && link && (
        <button
          type="button"
          className="studio-button"
          aria-label={`Open ${row.title}`}
          onClick={() => link.open()}
        >
          <Icon name="open_in_new" />
          Open
        </button>
      )}
    </li>
  );
}

export type EndedResultsProps = {
  session: Pick<LiveSessionView, "id" | "workspaceDraft">;
  answers: readonly AnswerRow[];
  withheld: WithheldNotice | null;
  coding: readonly CodingRow[];
};

export function EndedResults({
  session,
  answers,
  withheld,
  coding,
}: EndedResultsProps) {
  return (
    <section aria-labelledby="ended-results-title">
      <h3 id="ended-results-title" className="ended-heading">
        Results
      </h3>
      <ul className="ended-results">
        {answers.map((row) => (
          <AnswerResult key={row.taskId} row={row} />
        ))}
        {withheld && <WithheldResult notice={withheld} />}
        {coding.map((row) => (
          <CodingResult
            key={row.taskId || "workspace"}
            row={row}
            session={session}
          />
        ))}
        {answers.length === 0 && !withheld && coding.length === 0 && (
          <li className="ended-result" data-testid="ended-no-results">
            <Icon name="radio_button_unchecked" />
            <div className="ended-result-body">
              <div className="ended-result-title">
                No answer or code drafts were published
              </div>
            </div>
          </li>
        )}
        {/* rule:no-promotion: generated answers and transcript statements are
            never added to the matrix or the exercise catalogue. */}
        <li className="ended-result" data-testid="ended-no-promotion">
          <Icon name="lock" />
          <div className="ended-result-body">
            <div className="ended-result-title">
              The session added nothing to your matrix or exercise catalogue
            </div>
            <div className="live-note">
              Drafts stay private to you unless you promote or export them.
            </div>
          </div>
        </li>
      </ul>
    </section>
  );
}
