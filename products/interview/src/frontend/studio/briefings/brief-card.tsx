import type { Brief } from "@omnitech/interview-contracts";
import { useState } from "react";
import { Icon } from "../icon";
import { PracticeTimer } from "../practice-timer";
import { InlineText } from "../workspace/inline-text";

// A spoken brief, laid out to be said in 60–90 seconds.
export function BriefCard({
  brief,
  onDelete,
}: {
  brief: Brief;
  onDelete(): void;
}) {
  const [open, setOpen] = useState<number | null>(0);
  const { headline, points, example, pitfall, followUps } = brief.brief;
  return (
    <div className="brief">
      <PracticeTimer seconds={90} />
      <section className="brief-section">
        <div className="ws-label">Headline</div>
        <p className="brief-headline">
          <InlineText>{headline}</InlineText>
        </p>
      </section>
      <section className="brief-section">
        <div className="ws-label">Three points</div>
        <ol className="brief-points">
          {points.map((point, index) => (
            <li key={point.heading}>
              <span className="brief-number">{index + 1}</span>
              <div>
                <strong>
                  <InlineText>{point.heading.replaceAll("**", "")}</InlineText>
                </strong>{" "}
                <span className="brief-muted">
                  <InlineText>{point.body}</InlineText>
                </span>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <div className="brief-pair">
        <div className="brief-box">
          <div className="brief-box-title">
            <span className="ws-tone-green">
              <Icon name="lightbulb" size={16} />
            </span>
            Example to use
          </div>
          <p className="brief-muted">
            <InlineText>{example}</InlineText>
          </p>
        </div>
        <div className="brief-box">
          <div className="brief-box-title">
            <span className="ws-tone-amber">
              <Icon name="warning" size={16} />
            </span>
            Don’t say
          </div>
          <p className="brief-muted">
            <InlineText>{pitfall}</InlineText>
          </p>
        </div>
      </div>
      <section className="brief-section">
        <div className="ws-label">Likely follow-ups</div>
        {followUps.map((followUp, index) => (
          <div key={followUp.question} className="brief-followup">
            <button
              type="button"
              aria-expanded={open === index}
              onClick={() => setOpen(open === index ? null : index)}
            >
              <span>{followUp.question}</span>
              <Icon name={open === index ? "expand_less" : "expand_more"} />
            </button>
            {open === index && (
              <p className="brief-muted">
                <InlineText>{followUp.answer}</InlineText>
              </p>
            )}
          </div>
        ))}
      </section>
      <div>
        <button
          type="button"
          className="home-link"
          onClick={() => {
            if (window.confirm("Delete this brief?")) onDelete();
          }}
        >
          Delete brief
        </button>
      </div>
    </div>
  );
}
