import type { BriefingSection } from "@omnitech/interview-contracts";
import { MarkdownContent } from "../../../markdown-content";
import { Icon } from "../../icon";

const INTROS: Record<string, string> = {
  stories:
    "You don’t need 20 prepared answers. A handful of real stories covers most of what this role can ask, so reuse them. Each one comes from a role in your matrix.",
  ask: "Four good questions is plenty. Mark them off as you ask them.",
  watch:
    "What tends to go wrong in this kind of call, and what to say instead.",
};

// One tab of the prepared briefing: the sections with these headings.
export function SectionsTab({
  tab,
  sections,
  preparing,
  error,
  onPrepare,
}: {
  tab: string;
  sections: readonly BriefingSection[];
  preparing: boolean;
  error: string;
  onPrepare(): void;
}) {
  if (!sections.length)
    return (
      <div className="bp-card bp-empty">
        {preparing ? (
          <p role="status">
            <span className="bp-spinner" /> Preparing the briefing from your
            matrix and the interview details…
          </p>
        ) : (
          <>
            <p>
              The briefing covers the shape of the call, how to position
              yourself, the stories to reuse, questions to ask and what to
              avoid.
            </p>
            <button
              type="button"
              className="studio-button primary"
              onClick={onPrepare}
            >
              <Icon name="auto_awesome" />
              Prepare the briefing
            </button>
          </>
        )}
        {error && (
          <p className="bp-error" role="alert">
            <Icon name="error" />
            {error}
          </p>
        )}
      </div>
    );
  return (
    <>
      {INTROS[tab] && <p className="bp-intro">{INTROS[tab]}</p>}
      {sections.map((section) => (
        <section key={section.heading} className="bp-card bp-briefing-section">
          <div className="bp-eyebrow">{section.heading}</div>
          <div className="bp-section-text">
            <MarkdownContent>{section.markdown}</MarkdownContent>
          </div>
          {section.gaps.length > 0 && (
            <ul className="bp-gaps">
              {section.gaps.map((gap) => (
                <li key={gap}>
                  <Icon name="warning" size={15} />
                  {gap}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {tab === "overview" && (
        <div className="bp-row">
          <button
            type="button"
            className="studio-button"
            disabled={preparing}
            onClick={onPrepare}
          >
            <Icon name="refresh" size={16} />
            {preparing ? "Preparing…" : "Prepare again"}
          </button>
          {error && (
            <p className="bp-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
