import { briefingCategoryOf } from "@omnitech/interview-contracts";
import { useState } from "react";
import { Icon } from "../../icon";
import { CATEGORY_LABELS } from "./config";
import { Button } from "../../../ui";

const MAX_QUESTIONS = 20;

// The questions the person expects, edited before any answer is drafted.
export function QuestionsCard({
  questions,
  stageLabel,
  note,
  canDraft,
  onChange,
  onReset,
  onDraft,
}: {
  questions: readonly string[];
  stageLabel: string;
  note: string;
  canDraft: boolean;
  onChange(questions: string[]): void;
  onReset(): void;
  onDraft(): void;
}) {
  const [next, setNext] = useState("");
  const add = () => {
    if (!next.trim() || questions.length >= MAX_QUESTIONS) return;
    onChange([...questions, next.trim()]);
    setNext("");
  };
  return (
    <div className="bp-card bp-questions">
      <div className="bp-card-head">
        <span className="bp-grow">Questions you’ll be asked</span>
        <span className="bp-meta">
          Suggested for a {stageLabel.toLowerCase()}
        </span>
        <Button onClick={onReset}>Reset</Button>
      </div>
      {questions.map((question, index) => (
        // Index key: questions are plain strings with no id; each row is fully controlled by its value, so removing one keeps no stale per-row state.
        <div key={index} className="bp-question-row">
          <span className="bp-mono">{index + 1}</span>
          <input
            aria-label={`Question ${index + 1}`}
            value={question}
            onChange={(event) =>
              onChange(
                questions.map((item, at) =>
                  at === index ? event.target.value : item,
                ),
              )
            }
          />
          <span className="bp-tag">
            {CATEGORY_LABELS[briefingCategoryOf(question)]}
          </span>
          <button
            type="button"
            className="studio-icon-button"
            aria-label={`Remove question ${index + 1}`}
            onClick={() => onChange(questions.filter((_, at) => at !== index))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
      <div className="bp-question-row add">
        <Icon name="add" />
        <input
          aria-label="Add a question"
          value={next}
          disabled={questions.length >= MAX_QUESTIONS}
          placeholder={
            questions.length >= MAX_QUESTIONS
              ? "A pack holds 20 questions"
              : "Add a question you expect, then press Enter"
          }
          onChange={(event) => setNext(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
      </div>
      <div className="bp-card-foot">
        <span className="bp-meta bp-grow">{note}</span>
        <Button
          variant="primary"
          size="lg"
          disabled={!canDraft}
          onClick={onDraft}
        >
          <Icon name="auto_awesome" />
          Draft answers
        </Button>
      </div>
    </div>
  );
}
