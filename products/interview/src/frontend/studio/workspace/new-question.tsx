import {
  type LanguageSelection,
  routeQuestion,
} from "@omnitech/interview-contracts";
import { useEffect, useState } from "react";
import {
  type ExampleTemplate,
  exampleTemplates,
} from "../../example-templates";
import { Button } from "../../ui";
import { Icon } from "../icon";
import { LANGUAGE_LABELS } from "./stages";

const LANGUAGES: readonly { id: LanguageSelection; label: string }[] = [
  { id: "auto", label: "Auto-detect language" },
  ...Object.entries(LANGUAGE_LABELS).map(([id, label]) => ({
    id: id as LanguageSelection,
    label,
  })),
];

// An empty question: paste it, then solve it yourself or have it drafted.
export function NewQuestion({
  busy,
  error,
  onSolve,
  onDraft,
  onExample,
}: {
  busy: boolean;
  error: string;
  onSolve(question: string, language: LanguageSelection): void;
  onDraft(question: string, language: LanguageSelection): void;
  onExample(example: ExampleTemplate): void;
}) {
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState<LanguageSelection>("auto");
  const ready = question.trim().length > 0 && !busy;
  // [DOMAIN] Show which language the answer will be in, and why, before a
  // minute of drafting goes into the wrong one.
  const route = question.trim() ? routeQuestion(question, language) : undefined;
  const target = route ? LANGUAGE_LABELS[route.language] : undefined;
  const seconds = useElapsedSeconds(busy);
  return (
    <div className="studio-page">
      <div className="ws-new">
        <div>
          <h1>What’s the question?</h1>
          <p>
            Paste it as the interviewer would say it. A drafted answer splits it
            into the prompt, examples and constraints.
          </p>
        </div>
        <div className="ws-new-card">
          <textarea
            aria-label="Interview question"
            rows={6}
            value={question}
            placeholder="e.g. Given an array of timestamps and a window size, return the maximum number of events inside any window…"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <div className="ws-new-actions">
            <select
              aria-label="Language"
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as LanguageSelection)
              }
            >
              {LANGUAGES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className="ws-spacer" />
            <Button
              disabled={!ready}
              onClick={() => onSolve(question.trim(), language)}
            >
              Solve it myself
            </Button>
            <Button
              variant="primary"
              disabled={!ready}
              onClick={() => onDraft(question.trim(), language)}
            >
              <Icon name="auto_awesome" />
              {busy ? "Drafting…" : "Draft with assistant"}
            </Button>
          </div>
          {busy ? (
            <p className="ws-new-status" role="status">
              <span className="ws-spinner" />
              Drafting a {target} answer · {seconds} s · a local model can take
              a minute
            </p>
          ) : (
            route && (
              <p className="ws-new-status">
                Answer in <strong>{target}</strong> · {route.reasons[0]}
              </p>
            )
          )}
          {error && (
            <p className="ws-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="ws-examples">
          <div className="ws-muted">Or start from an example</div>
          <div className="ws-example-grid">
            {exampleTemplates.map((example) => (
              <button
                key={example.id}
                type="button"
                className="ws-example-card"
                disabled={busy}
                onClick={() => onExample(example)}
              >
                <span>{example.answer.title}</span>
                <span className="ws-mono">
                  {LANGUAGE_LABELS[example.language]}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Seconds since `running` became true; 0 while idle.
function useElapsedSeconds(running: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.round((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [running]);
  return seconds;
}
