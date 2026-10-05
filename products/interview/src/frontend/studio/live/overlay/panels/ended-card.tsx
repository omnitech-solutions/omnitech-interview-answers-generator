// The card a finished session leaves under the panes: how long it ran and what
// it held, as counts only (taken from the session in memory, never sent or
// logged). The last answer stays readable above it; the footer offers the
// summary and a new session.
import type { LiveStats } from "../../session-state";
import type { PanelSession } from "./panel-views";

const END_STATS: readonly {
  key: keyof LiveStats;
  one: string;
  other: string;
}[] = [
  { key: "utterances", one: "utterance", other: "utterances" },
  { key: "tasks", one: "task", other: "tasks" },
  { key: "answersPublished", one: "answer", other: "answers" },
  { key: "codeDraftsPublished", one: "code draft", other: "code drafts" },
];

export function EndedCard({ s }: { s: PanelSession }) {
  const { stats, elapsedLabel } = s.model;
  return (
    <section
      className="pn-ended"
      aria-label="Session ended"
      data-testid="pn-ended"
    >
      <h2 className="pn-ended-title">Session ended · {elapsedLabel}</h2>
      <p className="pn-ended-note">
        Capture stopped and running work was cancelled. Nothing was submitted or
        typed for you.
      </p>
      <ul className="pn-ended-stats">
        {END_STATS.map((stat) => (
          <li key={stat.key}>
            <b>{stats[stat.key]}</b>{" "}
            {stats[stat.key] === 1 ? stat.one : stat.other}
          </li>
        ))}
      </ul>
    </section>
  );
}
