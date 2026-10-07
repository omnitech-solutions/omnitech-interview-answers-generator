// The card a finished session leaves under the panes: how long it ran and what
// it held, as counts only (taken from the session in memory, never sent or
// logged). The last answer stays readable above it; the footer offers the
// summary and a new session.
import { Panel } from "@oc-tech/omni-ui-components";
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
  // The wrapper is the card's hit region (the native shell clicks only on drawn
  // surfaces) and keeps it one row high under the panes.
  return (
    <div className="pn-ended" data-testid="pn-ended">
      <Panel title={`Session ended · ${elapsedLabel}`} bodyPadding="md">
        <p className="pn-ended-note">
          Capture stopped and running work was cancelled. Nothing was submitted
          or typed for you.
        </p>
        <ul className="pn-ended-stats">
          {END_STATS.map((stat) => (
            <li key={stat.key}>
              <b>{stats[stat.key]}</b>{" "}
              {stats[stat.key] === 1 ? stat.one : stat.other}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
