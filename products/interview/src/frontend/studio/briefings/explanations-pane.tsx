import type { PlaygroundExplanation } from "@omnitech/interview-playground-control";
import { MarkdownContent } from "../../markdown-content";

// Concept explanations pushed by `interview-answers playground`. The first
// is the briefing; each follow-up appended after it starts collapsed.
export function ExplanationsPane({
  explanations,
}: {
  explanations: readonly PlaygroundExplanation[];
}) {
  if (!explanations.length)
    return (
      <p className="ws-loading" role="status">
        No concept explanations have been pushed yet.
      </p>
    );
  return (
    <div className="briefings-explanations">
      {explanations.map((explanation, index) => (
        <details
          // biome-ignore lint/suspicious/noArrayIndexKey: the items carry no id and repeat, and the list is rebuilt whole from its source in a fixed order, never reordered
          key={`${index}:${explanation.title}`}
          className="briefings-explanation"
          open={index === 0}
        >
          <summary>
            <span className="briefings-item-title">{explanation.title}</span>
            <span className="briefings-item-meta">{explanation.topic}</span>
          </summary>
          <MarkdownContent>{explanation.markdown}</MarkdownContent>
        </details>
      ))}
    </div>
  );
}
