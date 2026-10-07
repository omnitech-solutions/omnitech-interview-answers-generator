import { Button } from "@oc-tech/omni-ui-components";
import type { BriefKind } from "@omnitech/interview-contracts";
import { type ReactNode, useState } from "react";

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
  behavioural,
}: {
  busy: boolean;
  error: string;
  onBuild(kind: BriefKind, topic: string): void;
  // The behavioural pack's setup, shown in place of a topic.
  behavioural: ReactNode;
}) {
  const [kind, setKind] = useState<Kind>("concept");
  const [topic, setTopic] = useState("");
  const current = KINDS.find((item) => item.id === kind)!;
  return (
    <div className="ws-new">
      {kind === "behavioural" ? (
        <div>
          <h1>Prepare for a screening or behavioural interview</h1>
          <p>
            Answers are drafted from your experience matrix, and each one links
            back to the roles it uses. Review them, practise out loud, then save
            the pack.
          </p>
        </div>
      ) : (
        <div>
          <h1>What do you need to explain?</h1>
          <p>
            You’ll get a headline, three points, an example and the follow-ups
            to expect — sized for a 60–90 second answer.
          </p>
        </div>
      )}
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
        behavioural
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
            <Button
              variant="default"
              type="submit"
              disabled={!topic.trim() || busy}
            >
              {busy ? "Building…" : "Build briefing"}
            </Button>
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
