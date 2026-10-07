import { Button } from "@oc-tech/omni-ui-components";
import type {
  BriefingQuestion,
  CandidateMatrix,
} from "@omnitech/interview-contracts";
import { useEffect, useState } from "react";
import { MarkdownContent } from "../../../markdown-content";
import { Icon } from "../../icon";
import { PracticeTimer } from "../../practice-timer";
import { CATEGORY_LABELS, spokenSeconds } from "./config";

// A question still being answered, shown in place until its answer lands.
export type PendingAnswer = {
  question: string;
  state: "queued" | "drafting" | "failed";
  error?: string;
};

const CONTEXT_LABELS: Record<string, string> = {
  request: "Your request",
  jobDescription: "Job description",
  employerNotes: "Employer notes",
  research: "Research",
  candidatePreferences: "Your preferences",
};

// [DOMAIN] Evidence is grouped by where it came from: one chip per matrix
// role or employer document, opening the exact quotes the answer used.
function sourcesOf(answer: BriefingQuestion, matrix: CandidateMatrix | null) {
  const groups = new Map<
    string,
    { label: string; detail: string; quotes: string[] }
  >();
  for (const ref of answer.evidenceRefs) {
    const role = /^\/roles\/(\d+)/.exec(ref.pointer);
    const context = /^\/context\/(\w+)/.exec(ref.pointer);
    const key = role?.[0] ?? context?.[0] ?? ref.pointer;
    const matrixRole = role ? matrix?.roles[Number(role[1])] : undefined;
    const group = groups.get(key) ?? {
      label:
        matrixRole?.company ?? CONTEXT_LABELS[context?.[1] ?? ""] ?? "Matrix",
      detail: matrixRole
        ? `${matrixRole.title}${matrixRole.period ? ` · ${matrixRole.period}` : ""}`
        : "",
      quotes: [],
    };
    if (!group.quotes.includes(ref.quote)) group.quotes.push(ref.quote);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
}

export function AnswersTab({
  answers,
  pending,
  matrix,
  redrafting,
  focus,
  onAccept,
  onAcceptAll,
  onRedraft,
  onEdit,
  onChangeQuestions,
}: {
  answers: readonly BriefingQuestion[];
  pending: readonly PendingAnswer[];
  matrix: CandidateMatrix | null;
  redrafting: string | null;
  // An answer just asked for, opened when it arrives.
  focus: string | null;
  onAccept(id: string, accepted: boolean): void;
  onAcceptAll(): void;
  onRedraft(id: string): void;
  onEdit(id: string, markdown: string): void;
  onChangeQuestions(): void;
}) {
  // Until the person picks one, the first answer is open.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (focus) setPicked(focus);
  }, [focus]);
  // A removed answer gives way to the first one.
  const open =
    picked === null
      ? null
      : picked !== undefined && answers.some((answer) => answer.id === picked)
        ? picked
        : (answers[0]?.id ?? null);
  const setOpen = setPicked;
  const accepted = answers.filter((answer) => answer.accepted).length;
  const total = answers.length + pending.length;
  const drafting = pending.some((item) => item.state !== "failed");

  return (
    <>
      <div className="bp-progress-row">
        <div className="bp-grow">
          <div className="bp-progress-label">
            <strong>
              {drafting ? "Drafting answers…" : "Review your answers"}
            </strong>
            <span className="bp-mono">
              {accepted} / {total} accepted
            </span>
          </div>
          <div className="bp-progress">
            <div
              style={{ width: `${total ? (accepted / total) * 100 : 0}%` }}
            />
          </div>
        </div>
        <Button
          variant="outline"
          disabled={!answers.length || accepted === answers.length}
          onClick={onAcceptAll}
        >
          Accept all
        </Button>
      </div>
      {answers.map((answer) => (
        <AnswerCard
          key={answer.id}
          answer={answer}
          matrix={matrix}
          open={open === answer.id}
          busy={redrafting === answer.id}
          onToggle={() => setOpen(open === answer.id ? null : answer.id)}
          onAccept={(value) => onAccept(answer.id, value)}
          onRedraft={() => onRedraft(answer.id)}
          onEdit={(markdown) => onEdit(answer.id, markdown)}
        />
      ))}
      {pending.map((item, index) => (
        <div key={`${index}:${item.question}`} className="bp-answer">
          <div className="bp-answer-head static">
            <span className={`bp-dot ${item.state}`}>
              {item.state === "drafting" ? (
                <span className="bp-spinner" />
              ) : (
                <Icon
                  name={item.state === "failed" ? "priority_high" : "schedule"}
                  size={15}
                />
              )}
            </span>
            <div className="bp-grow">
              <div className="bp-answer-question">{item.question}</div>
              <div
                className={`bp-meta${item.state === "failed" ? " bp-error" : ""}`}
              >
                {item.state === "queued"
                  ? "Queued"
                  : item.state === "drafting"
                    ? "Drafting from your matrix…"
                    : (item.error ?? "This answer couldn’t be drafted.")}
              </div>
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="bp-back" onClick={onChangeQuestions}>
        <Icon name="arrow_back" size={16} />
        Change questions
      </button>
    </>
  );
}

function AnswerCard({
  answer,
  matrix,
  open,
  busy,
  onToggle,
  onAccept,
  onRedraft,
  onEdit,
}: {
  answer: BriefingQuestion;
  matrix: CandidateMatrix | null;
  open: boolean;
  busy: boolean;
  onToggle(): void;
  onAccept(accepted: boolean): void;
  onRedraft(): void;
  onEdit(markdown: string): void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [practising, setPractising] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const sources = sourcesOf(answer, matrix);
  const openSource = sources.find((item) => item.key === source);
  const seconds = spokenSeconds(answer.answerMarkdown);
  const meta = [
    `~${seconds} s spoken`,
    answer.gaps.length ? `${answer.gaps.length} to check` : undefined,
    answer.accepted ? "accepted" : "ready to review",
  ]
    .filter(Boolean)
    .join(" · ");
  const state = busy
    ? "drafting"
    : answer.accepted
      ? "accepted"
      : answer.gaps.length
        ? "warn"
        : "ready";

  return (
    <div className={`bp-answer${answer.accepted ? " accepted" : ""}`}>
      <button
        type="button"
        className="bp-answer-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={`bp-dot ${state}`}>
          {busy ? (
            <span className="bp-spinner" />
          ) : (
            <Icon
              name={
                answer.accepted
                  ? "check"
                  : answer.gaps.length
                    ? "priority_high"
                    : "edit"
              }
              size={15}
            />
          )}
        </span>
        <span className="bp-grow">
          <span className="bp-answer-question">{answer.question}</span>
          <span className="bp-meta">
            <span className="bp-tag">{CATEGORY_LABELS[answer.category]}</span>
            {busy ? "Drafting a new version…" : meta}
          </span>
        </span>
        <Icon name={open ? "expand_less" : "expand_more"} />
      </button>
      {open && (
        <div className="bp-answer-body">
          {editing === null ? (
            <div className="bp-answer-text">
              <MarkdownContent>{answer.answerMarkdown}</MarkdownContent>
            </div>
          ) : (
            <div className="bp-edit">
              <textarea
                rows={7}
                aria-label="Answer"
                value={editing}
                onChange={(event) => setEditing(event.target.value)}
              />
              <div className="bp-row end">
                <Button variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  variant="default"
                  disabled={!editing.trim()}
                  onClick={() => {
                    onEdit(editing.trim());
                    setEditing(null);
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          )}
          <ul className="bp-points" aria-label="Talking points">
            {answer.talkingPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          {answer.gaps.length > 0 && (
            <ul className="bp-gaps" aria-label="Check before using">
              {answer.gaps.map((gap) => (
                <li key={gap}>
                  <Icon name="warning" size={15} />
                  {gap}
                </li>
              ))}
            </ul>
          )}
          {sources.length > 0 && (
            <div className="bp-row wrap">
              <span className="bp-faint">Based on</span>
              {sources.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="bp-source"
                  aria-pressed={source === item.key}
                  onClick={() =>
                    setSource(source === item.key ? null : item.key)
                  }
                >
                  <Icon name="work" size={14} />
                  {item.label}
                </button>
              ))}
            </div>
          )}
          {openSource && (
            <div className="bp-source-card">
              <strong>{openSource.label}</strong>
              {openSource.detail && (
                <span className="bp-meta">{openSource.detail}</span>
              )}
              {openSource.quotes.map((quote) => (
                <q key={quote}>{quote}</q>
              ))}
            </div>
          )}
          {practising && (
            <PracticeTimer
              seconds={Math.max(60, Math.min(120, seconds + 15))}
            />
          )}
          <div className="bp-row wrap">
            <Button
              variant="outline"
              pressed={practising}
              onClick={() => setPractising(!practising)}
            >
              <Icon name="mic" size={16} />
              {practising ? "Stop practising" : "Practise"}
            </Button>
            <Button variant="outline" disabled={busy} onClick={onRedraft}>
              <Icon name="refresh" size={16} />
              New draft
            </Button>
            <Button
              variant="outline"
              disabled={busy || editing !== null}
              onClick={() => setEditing(answer.answerMarkdown)}
            >
              <Icon name="edit" size={16} />
              Edit
            </Button>
            <span className="bp-grow" />
            {answer.accepted ? (
              <button
                type="button"
                className="bp-accepted"
                title="Undo accept"
                onClick={() => onAccept(false)}
              >
                <Icon name="check_circle" size={16} filled />
                Accepted
              </button>
            ) : (
              <button
                type="button"
                className="bp-accept"
                disabled={busy}
                onClick={() => onAccept(true)}
              >
                <Icon name="check" size={16} />
                Accept
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
