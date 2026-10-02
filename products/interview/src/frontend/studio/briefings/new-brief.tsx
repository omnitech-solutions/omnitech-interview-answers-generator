import type { BriefKind } from "@omnitech/interview-contracts";
import { useState } from "react";

// The three kinds of briefing. Behavioural answers come from the person's own
// experience, so they are built as an evidence-backed preparation pack.
const KINDS = [
  {
    id: "concept",
    label: "Concept",
    placeholder: "e.g. Explain React reconciliation",
  },
  {
    id: "system-design",
    label: "System design",
    placeholder: "e.g. Design a URL shortener",
  },
  {
    id: "behavioural",
    label: "Behavioural",
    placeholder: "e.g. A time I modernised an older workflow",
  },
] as const;
type Kind = (typeof KINDS)[number]["id"];

export function NewBrief({
  busy,
  error,
  onBuild,
  onBehavioural,
}: {
  busy: boolean;
  error: string;
  onBuild(kind: BriefKind, topic: string): void;
  onBehavioural(): void;
}) {
  const [kind, setKind] = useState<Kind>("concept");
  const [topic, setTopic] = useState("");
  const current = KINDS.find((item) => item.id === kind)!;
  return (
    <div className="ws-new">
      <div>
        <h1>What do you need to explain?</h1>
        <p>
          You’ll get a headline, three points, an example and the follow-ups to
          expect — sized for a 60–90 second answer.
        </p>
      </div>
      <div className="brief-kinds" role="radiogroup" aria-label="Kind">
        {KINDS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={kind === item.id}
            onClick={() => setKind(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {kind === "behavioural" ? (
        <div className="ws-new-card brief-behavioural">
          <p>
            Behavioural answers are built from your experience matrix, with each
            claim linked to its source, for a specific company and stage.
          </p>
          <div className="ws-new-actions">
            <span className="ws-spacer" />
            <button
              type="button"
              className="studio-button primary"
              onClick={onBehavioural}
            >
              Start a preparation pack
            </button>
          </div>
        </div>
      ) : (
        <form
          className="ws-new-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (topic.trim() && !busy) onBuild(kind, topic.trim());
          }}
        >
          <textarea
            aria-label="Topic"
            rows={3}
            value={topic}
            placeholder={current.placeholder}
            onChange={(event) => setTopic(event.target.value)}
          />
          <div className="ws-new-actions">
            <span className="ws-spacer" />
            <button
              type="submit"
              className="studio-button primary"
              disabled={!topic.trim() || busy}
            >
              {busy ? "Building…" : "Build briefing"}
            </button>
          </div>
          {error && (
            <p className="ws-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
