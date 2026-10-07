// The body of an answer task: the suggested answer as point form (bullets and
// bold key terms, never markup) with a Copy button, the claims behind it (each with its provenance chip), STAR sections
// for a behavioural question, and what was found or is missing for logistics.
// The draft and every claim are session content: inert text only.

import { Button } from "@oc-tech/omni-ui-components";
import { Icon } from "../icon";
import { ClaimList } from "./claim-chips";
import type {
  AnswerResult,
  LogisticsField,
  StarElement,
} from "./session-results";
import type { TaskView } from "./session-tasks";
import { DraftPoints, plainDraft } from "./shared/draft-text";
import type { TaskCard } from "./shared/task-card-model";

const STAR_LABEL: Record<StarElement, string> = {
  situation: "Situation",
  task: "Task",
  action: "Action",
  result: "Result",
};
const LOGISTICS_LABEL: Record<LogisticsField, string> = {
  "notice-period": "Notice period",
  compensation: "Compensation",
  "work-arrangement": "Work arrangement",
};

function Star({ answer }: { answer: AnswerResult }) {
  return (
    <div className="live-star">
      {answer.star?.map((part) => (
        <section
          key={part.element}
          className="live-star-part"
          aria-label={STAR_LABEL[part.element]}
        >
          <h4>{STAR_LABEL[part.element]}</h4>
          {part.missing || part.text === "" ? (
            <p className="live-note">
              Your approved experience doesn’t cover this part, so no text was
              drafted. Say it from memory or add it to your matrix.
            </p>
          ) : (
            <p className="live-draft-text">{part.text}</p>
          )}
          <ClaimList
            claims={part.claims}
            label={`${STAR_LABEL[part.element]} claims`}
          />
        </section>
      ))}
    </div>
  );
}

function Logistics({ answer }: { answer: AnswerResult }) {
  const logistics = answer.logistics;
  if (!logistics) return null;
  return (
    <div className="live-logistics">
      <section aria-label="What was found">
        <h4>Found in your approved preferences</h4>
        {logistics.found.length === 0 && (
          <p className="live-note">Nothing was found.</p>
        )}
        <ul className="live-claims">
          {logistics.found.map((entry) => (
            <li key={entry.field}>
              <strong>{LOGISTICS_LABEL[entry.field]}</strong>
              {entry.claim && (
                <ClaimList
                  claims={[entry.claim]}
                  label={LOGISTICS_LABEL[entry.field]}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
      {logistics.missing.length > 0 && (
        <section aria-label="What is missing" className="live-missing">
          <h4>What is missing</h4>
          <p className="live-note">
            No matching approved preference line was found for these fields,
            even if this question did not ask about them.
          </p>
          <ul>
            {logistics.missing.map((field) => (
              <li key={field}>
                <strong>{LOGISTICS_LABEL[field]}</strong>: No matching approved
                preference line was found. Add it to your candidate context, or
                answer in your own words.
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function AnswerBody({
  task,
  card,
  answer,
  onCopy,
}: {
  task: TaskView;
  // The card's answer text is the one the owner reads and copies.
  card: TaskCard;
  answer: AnswerResult;
  onCopy(text: string): void;
}) {
  const text = card.answerText ?? "";
  // The newest revision that has an answer, for the "outdated" notice.
  const answeredRevision = [...task.revisions]
    .reverse()
    .find((revision) => revision.answer)?.revision;
  return (
    <div className="live-answer" data-stale={task.answerStale || undefined}>
      {task.answerStale && (
        <div className="live-notice amber" data-testid="stale-answer">
          <Icon name="history" />
          <p>
            <strong>Outdated.</strong> This answer was drafted for task rev{" "}
            {answeredRevision}. The task is now at rev {task.currentRevision},
            and no answer has been published for it yet.
          </p>
        </div>
      )}
      <div className="live-answer-head">
        <h3>Suggested answer</h3>
        {answer.pinned && (
          <span className="live-note">
            Checked against matrix revision {answer.pinned.revision}
          </span>
        )}
        <Button
          variant="outline"
          buttonSize="lg"
          onClick={() => onCopy(plainDraft(text))}
        >
          <Icon name="content_copy" />
          Copy answer
        </Button>
      </div>
      <p className="live-note">
        This suggested draft does not set candidate preferences. For notice,
        pay, availability or work arrangement, use only facts marked From your
        preferences. Review personal commitments before saying or copying them.
      </p>
      {text.trim() !== "" && (
        <div className="live-draft">
          <DraftPoints text={text} />
        </div>
      )}
      {answer.star ? (
        <Star answer={answer} />
      ) : answer.logistics ? (
        <Logistics answer={answer} />
      ) : (
        <ClaimList claims={answer.claims} label="Claims in this answer" />
      )}
      <p className="live-note">
        Private to you. Nothing here is added to your matrix or exercise
        catalogue.
      </p>
    </div>
  );
}
