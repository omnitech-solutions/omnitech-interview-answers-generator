import type {
  AnswerGuide,
  StageId,
  TestResult,
} from "@omnitech/interview-contracts";
import { MarkdownContent } from "../../markdown-content";
import { Button } from "../../ui";
import { Icon, type IconName } from "../icon";
import { PracticeTimer } from "../practice-timer";
import { type CoverageState, edgeCoverage } from "./coverage";
import { InlineText } from "./inline-text";
import { STAGES, stageIndex } from "./stages";

const COVERAGE: Record<
  CoverageState,
  { icon: IconName; tone: string; label: string }
> = {
  passing: { icon: "check_circle", tone: "green", label: "passing" },
  failing: { icon: "error", tone: "red", label: "test failing" },
  "not-run": { icon: "pending", tone: "muted", label: "not run yet" },
  "no-test": { icon: "warning", tone: "amber", label: "no test" },
  "not-found": {
    icon: "warning",
    tone: "amber",
    label: "not found in tests",
  },
};

export type StagePaneProps = {
  stage: StageId;
  question: string;
  // Undefined until the question has an answer.
  guide: AnswerGuide | undefined;
  notes: string;
  clarified: readonly number[];
  testResults: readonly TestResult[] | undefined;
  inContext: boolean;
  onStage(stage: StageId): void;
  onToggleClarified(index: number): void;
  onNotes(notes: string): void;
};

// The left column: what this stage asks of the candidate, from the guide.
export function StagePane(props: StagePaneProps) {
  const index = stageIndex(props.stage);
  const previous = STAGES[index - 1];
  const next = STAGES[index + 1];
  return (
    <div
      className={`ws-stage${props.inContext ? " assistant-in-context" : ""}`}
    >
      <StageBody {...props} />
      <div className="ws-stage-nav">
        {previous && (
          <Button onClick={() => props.onStage(previous.id)}>
            <Icon name="chevron_left" />
            {previous.label}
          </Button>
        )}
        <span className="ws-spacer" />
        {next && (
          <Button variant="primary" onClick={() => props.onStage(next.id)}>
            Next: {next.label}
            <Icon name="chevron_right" />
          </Button>
        )}
      </div>
    </div>
  );
}

function StageBody(props: StagePaneProps) {
  const { guide } = props;
  // Code is the scratchpad whatever the answer looks like.
  if (props.stage === "code") return <CodeStage {...props} />;
  // No answer yet: the question as written, and how to get a guide.
  if (!guide)
    return (
      <>
        <SectionLabel>The question</SectionLabel>
        <MarkdownContent>{props.question}</MarkdownContent>
        {props.stage !== "understand" && (
          <p className="ws-muted">
            Draft an answer to get a step-by-step guide for this stage.
          </p>
        )}
      </>
    );
  if (props.stage === "understand")
    return <UnderstandStage {...props} guide={guide} />;
  if (props.stage === "plan") return <PlanStage {...props} guide={guide} />;
  if (props.stage === "test") return <TestStage {...props} guide={guide} />;
  return <ExplainStage guide={guide} />;
}

function SectionLabel({ children }: { children: string }) {
  return <div className="ws-label">{children}</div>;
}

function UnderstandStage({
  guide,
  clarified,
  onToggleClarified,
}: StagePaneProps & { guide: AnswerGuide }) {
  const { prompt, examples, constraints, clarify } = guide.understand;
  return (
    <>
      <SectionLabel>The prompt</SectionLabel>
      <p className="ws-prompt">
        <InlineText>{prompt}</InlineText>
      </p>
      {examples.length > 0 && (
        <div className="ws-block">
          <div className="ws-block-title">
            {examples.length === 1 ? "Example" : "Examples"}
          </div>
          <div className="ws-example">
            {examples.map((example) => (
              <div key={`${example.input}→${example.output}`}>
                {example.input} → {example.output}
                {example.note && (
                  <span className="ws-faint"> · {example.note}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {constraints.length > 0 && (
        <div className="ws-block">
          <div className="ws-block-title">Constraints</div>
          <ul className="ws-list">
            {constraints.map((item) => (
              <li key={item}>
                <InlineText>{item}</InlineText>
              </li>
            ))}
          </ul>
        </div>
      )}
      {clarify.length > 0 && (
        <div className="ws-callout">
          <div className="ws-callout-head">
            <Icon name="record_voice_over" />
            <span>Ask before you code</span>
            <span className="ws-faint">
              {clarified.length} of {clarify.length}
            </span>
          </div>
          {clarify.map((item, index) => {
            const done = clarified.includes(index);
            return (
              <button
                key={item}
                type="button"
                role="checkbox"
                aria-checked={done}
                className={`ws-check${done ? " done" : ""}`}
                onClick={() => onToggleClarified(index)}
              >
                <span className="ws-box">
                  {done && <Icon name="check" size={12} />}
                </span>
                <span>
                  <InlineText>{item}</InlineText>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function CoverageRow({
  name,
  state,
  detail,
}: {
  name: string;
  state: CoverageState;
  detail: string;
}) {
  const look = COVERAGE[state];
  return (
    <div className="ws-coverage-row">
      <span className={`ws-tone-${look.tone}`}>
        <Icon name={look.icon} size={16} />
      </span>
      <span className="ws-coverage-text">
        <InlineText>{name}</InlineText>
        <span className="ws-faint">{detail}</span>
      </span>
    </div>
  );
}

function PlanStage({
  guide,
  testResults,
}: StagePaneProps & { guide: AnswerGuide }) {
  const { steps, complexity } = guide.plan;
  return (
    <>
      <SectionLabel>Your approach</SectionLabel>
      <ol className="ws-steps">
        {steps.map((step) => (
          <li key={step}>
            <InlineText>{step}</InlineText>
          </li>
        ))}
      </ol>
      <div className="ws-complexity">
        <div>
          <div className="ws-faint">Time</div>
          <div className="ws-big-mono">{complexity.time}</div>
        </div>
        <div>
          <div className="ws-faint">Space</div>
          <div className="ws-big-mono">{complexity.space}</div>
        </div>
      </div>
      {complexity.note && (
        <p className="ws-muted">
          <InlineText>{complexity.note}</InlineText>
        </p>
      )}
      {guide.edgeCases.length > 0 && (
        <div className="ws-block">
          <div className="ws-block-title">Edge cases</div>
          {edgeCoverage(guide, testResults).map((edge) => (
            <CoverageRow
              key={edge.name}
              name={edge.name}
              state={edge.state}
              detail={edge.test ? "1 test" : "no test"}
            />
          ))}
        </div>
      )}
    </>
  );
}

function CodeStage({ notes, onNotes }: StagePaneProps) {
  return (
    <>
      <SectionLabel>Scratchpad</SectionLabel>
      <textarea
        className="ws-scratchpad"
        aria-label="Scratchpad"
        rows={10}
        value={notes}
        onChange={(event) => onNotes(event.target.value)}
      />
      <div className="ws-tip">
        <Icon name="lightbulb" />
        <span>
          Narrate as you type: name the function, say what each branch protects
          against, then run the tests out loud.
        </span>
      </div>
    </>
  );
}

function TestStage({
  guide,
  testResults,
}: StagePaneProps & { guide: AnswerGuide }) {
  const coverage = edgeCoverage(guide, testResults);
  return (
    <>
      <SectionLabel>Coverage</SectionLabel>
      <p className="ws-muted">
        Each edge case should map to at least one test.
      </p>
      {coverage.length ? (
        <div className="ws-coverage">
          {coverage.map((edge) => (
            <CoverageRow
              key={edge.name}
              name={edge.name}
              state={edge.state}
              detail={
                edge.test
                  ? `${edge.test} · ${COVERAGE[edge.state].label}`
                  : COVERAGE[edge.state].label
              }
            />
          ))}
        </div>
      ) : (
        <p className="ws-muted">This answer lists no edge cases.</p>
      )}
      {!testResults && (
        <p className="ws-muted">Run the tests (⌘↵) to see which cases pass.</p>
      )}
    </>
  );
}

function ExplainStage({ guide }: { guide: AnswerGuide }) {
  return (
    <>
      <SectionLabel>Two-minute explanation</SectionLabel>
      <PracticeTimer seconds={120} />
      {guide.explain.map((section) => (
        <div key={section.heading} className="ws-explain">
          <div className="ws-block-title">{section.heading}</div>
          <div>
            <InlineText>{section.body}</InlineText>
          </div>
        </div>
      ))}
      <div className="ws-block">
        <div className="ws-block-title">Talking points</div>
        <ul className="ws-list">
          {guide.talkingPoints.map((point) => (
            <li key={point}>
              <InlineText>{point}</InlineText>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
