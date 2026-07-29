"use client";

import { Button, Card } from "@oc-tech/omni-ui-components";
import type { MockInterviewControl } from "@omnitech/interview-playground-control";
import { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "interview-studio.mock-interview";
const SESSION_SECONDS = 60 * 60;
const CONCEPT_SECONDS = 15 * 60;

type Phase = "setup" | "concept" | "coding" | "complete";
type Reveal =
  | "clarifying"
  | "hint1"
  | "hint2"
  | "pattern"
  | "approach"
  | "solution"
  | "tests";

interface MockQuestion {
  approach: string;
  clarifying: string;
  constraints: string[];
  examples: string[];
  hints: [string, string];
  id: string;
  pattern: string;
  signature: string;
  solution: string;
  statement: string;
  tests: string;
  title: string;
}

interface SessionState {
  activeSeconds: number;
  checklist: string[];
  code: string;
  complexity: string;
  firstPassingAt?: number;
  firstRunnableAt?: number;
  notes: string;
  phase: Phase;
  questionIndex: number;
  reveals: Reveal[];
  scratchpad: string;
  startedAt?: number;
  strict: boolean;
}

const checklist = [
  "Restate the problem",
  "Ask clarifying questions",
  "State assumptions",
  "Describe a brute-force approach",
  "Identify the key pattern",
  "Explain the invariant",
  "Walk through an example",
  "State time complexity",
  "State space complexity",
  "Test edge cases",
];

const questions: MockQuestion[] = [
  {
    id: "longest-unique-window",
    title: "Longest Unique Substring",
    statement:
      "Given a string, return the length of its longest substring containing no repeated characters.",
    examples: ['"abcabcbb" → 3', '"bbbbb" → 1', '"" → 0'],
    constraints: [
      "0 ≤ input.length ≤ 100,000",
      "The input may contain spaces and Unicode characters.",
      "The required solution should avoid rescanning the active substring.",
    ],
    signature: "function longestUniqueSubstring(input: string): number",
    clarifying:
      "Confirm that a substring is contiguous, an empty input returns 0, and characters are compared by value.",
    hints: [
      "Track the left boundary of a window that always contains unique characters.",
      "Store the most recent index of each character and move left forward, never backward.",
    ],
    pattern: "Sliding window with a hash map of last-seen indexes.",
    approach:
      "Scan once with a right pointer. When a character was seen inside the current window, advance left to one after its previous index. Record the new index and update the best window length.",
    solution:
      "export function longestUniqueSubstring(input: string): number {\n  let left = 0;\n  let best = 0;\n  const lastSeen = new Map<string, number>();\n\n  Array.from(input).forEach((character, right) => {\n    const previous = lastSeen.get(character);\n    if (previous !== undefined && previous >= left) left = previous + 1;\n    lastSeen.set(character, right);\n    best = Math.max(best, right - left + 1);\n  });\n\n  return best;\n}",
    tests:
      "expect(longestUniqueSubstring('abcabcbb')).toBe(3);\nexpect(longestUniqueSubstring('bbbbb')).toBe(1);\nexpect(longestUniqueSubstring('')).toBe(0);\nexpect(longestUniqueSubstring('abba')).toBe(2);",
  },
  {
    id: "pair-sum",
    title: "Pair Sum",
    statement:
      "Given an array of integers and a target, return the indexes of two distinct values whose sum is the target, or null when no pair exists.",
    examples: ["[2, 7, 11, 15], 9 → [0, 1]", "[3, 3], 6 → [0, 1]"],
    constraints: [
      "2 ≤ values.length ≤ 100,000",
      "Exactly one pair may be returned.",
      "Do not use the same array element twice.",
    ],
    signature:
      "function pairSum(values: number[], target: number): [number, number] | null",
    clarifying:
      "Confirm whether multiple answers are possible, whether indexes or values are required, and what to return when no pair exists.",
    hints: [
      "For each value, ask which complement would complete the target.",
      "Store previously visited values and their indexes in a map.",
    ],
    pattern: "One-pass complement lookup with a hash map.",
    approach:
      "Scan left to right. Check whether the current value's complement has already been seen. If so, return both indexes; otherwise store the current value and index.",
    solution:
      "export function pairSum(values: number[], target: number): [number, number] | null {\n  const indexes = new Map<number, number>();\n  for (let index = 0; index < values.length; index += 1) {\n    const complement = target - values[index];\n    const match = indexes.get(complement);\n    if (match !== undefined) return [match, index];\n    indexes.set(values[index], index);\n  }\n  return null;\n}",
    tests:
      "expect(pairSum([2, 7, 11, 15], 9)).toEqual([0, 1]);\nexpect(pairSum([3, 3], 6)).toEqual([0, 1]);\nexpect(pairSum([1, 2], 10)).toBeNull();",
  },
];

const initialState: SessionState = {
  activeSeconds: 0,
  checklist: [],
  code: "",
  complexity: "",
  notes: "",
  phase: "setup",
  questionIndex: 0,
  reveals: [],
  scratchpad: "",
  strict: false,
};

export function MockInterview({
  externalControl,
}: {
  externalControl?: MockInterviewControl;
}) {
  const [session, setSession] = useState<SessionState>(initialState);
  const [paused, setPaused] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setSession({ ...initialState, ...(JSON.parse(raw) as SessionState) });
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!externalControl) return;
    if (externalControl.action === "reset") {
      setSession(initialState);
      setPaused(false);
      return;
    }
    if (externalControl.action === "end") {
      setSession((current) => ({ ...current, phase: "complete" }));
      return;
    }
    if (externalControl.action === "start") {
      setSession({
        ...initialState,
        phase: "concept",
        startedAt: Date.now(),
        strict: externalControl.strict,
      });
      setPaused(false);
    }
  }, [externalControl]);

  useEffect(() => {
    if (!hydrated.current) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, [session]);

  useEffect(() => {
    if (paused || session.phase === "setup" || session.phase === "complete")
      return;
    const timer = window.setInterval(() => {
      setSession((current) => {
        const activeSeconds = current.activeSeconds + 1;
        const phase =
          activeSeconds >= SESSION_SECONDS
            ? "complete"
            : current.phase === "concept" && activeSeconds >= CONCEPT_SECONDS
              ? "coding"
              : current.phase;
        return { ...current, activeSeconds, phase };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [paused, session.phase]);

  const question = questions[session.questionIndex] ?? questions[0]!;
  const remaining = Math.max(0, SESSION_SECONDS - session.activeSeconds);
  const phaseRemaining =
    session.phase === "concept"
      ? Math.max(0, CONCEPT_SECONDS - session.activeSeconds)
      : session.phase === "coding"
        ? remaining
        : 0;
  const warning =
    phaseRemaining === 300
      ? "Five minutes remain in this phase."
      : phaseRemaining === 60
        ? "One minute remains in this phase."
        : "";
  const communicationScore = session.checklist.length * 10;
  const assistance = session.reveals.length;
  const score = useMemo(
    () => Math.max(0, communicationScore - assistance * 3),
    [assistance, communicationScore],
  );

  function start() {
    setSession({
      ...initialState,
      phase: "concept",
      startedAt: Date.now(),
      strict: session.strict,
    });
    setPaused(false);
  }

  function reveal(item: Reveal) {
    setSession((current) => ({
      ...current,
      reveals: current.reveals.includes(item)
        ? current.reveals
        : [...current.reveals, item],
    }));
  }

  if (session.phase === "setup") {
    return (
      <section className="mock-interview" aria-labelledby="mock-title">
        <div className="mock-heading">
          <div>
            <span className="eyebrow">REALISTIC REHEARSAL</span>
            <h2 id="mock-title">Mock Interview</h2>
            <p>15 minutes of concepts, then 45 minutes of coding.</p>
          </div>
        </div>
        <Card className="mock-setup">
          <strong>60-minute structured session</strong>
          <p>
            The reference approach, solution, and tests stay hidden until you
            explicitly reveal them. Reveals are recorded in your scorecard.
          </p>
          <label className="mock-check">
            <input
              type="checkbox"
              checked={session.strict}
              onChange={(event) =>
                setSession((current) => ({
                  ...current,
                  strict: event.target.checked,
                }))
              }
            />
            Strict mode (pausing disabled)
          </label>
          <Button onClick={start}>Start 60-minute session</Button>
        </Card>
      </section>
    );
  }

  if (session.phase === "complete") {
    return (
      <section className="mock-interview" aria-labelledby="scorecard-title">
        <div className="mock-heading">
          <div>
            <span className="eyebrow">SESSION COMPLETE</span>
            <h2 id="scorecard-title">Interview scorecard</h2>
          </div>
          <Button variant="outline" onClick={() => setSession(initialState)}>
            New session
          </Button>
        </div>
        <div className="mock-score-grid">
          <Card>
            <span>Overall practice score</span>
            <strong>{score}/100</strong>
          </Card>
          <Card>
            <span>Communication</span>
            <strong>{communicationScore}%</strong>
          </Card>
          <Card>
            <span>Reveals used</span>
            <strong>{assistance}</strong>
          </Card>
          <Card>
            <span>Active time</span>
            <strong>{formatTime(session.activeSeconds)}</strong>
          </Card>
        </div>
        <Card className="mock-summary">
          <h3>Timing</h3>
          <p>
            First runnable: {formatMetric(session.firstRunnableAt)} · First
            passing: {formatMetric(session.firstPassingAt)}
          </p>
          <h3>Recommended review</h3>
          <p>
            {session.checklist.length < checklist.length
              ? `Practice: ${checklist
                  .filter((item) => !session.checklist.includes(item))
                  .join(", ")}.`
              : "Communication checklist complete. Retry without revealing hints or the reference solution."}
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section className="mock-interview" aria-labelledby="mock-title">
      <div className="mock-heading">
        <div>
          <span className="eyebrow">
            {session.phase === "concept" ? "CONCEPT PHASE" : "CODING PHASE"}
          </span>
          <h2 id="mock-title">Mock Interview</h2>
        </div>
        <div className="mock-timers" aria-live="polite">
          <span>Session {formatTime(remaining)}</span>
          <strong>Phase {formatTime(phaseRemaining)}</strong>
          {warning ? <em>{warning}</em> : null}
        </div>
        <div className="mock-actions">
          {session.phase === "concept" ? (
            <Button
              variant="outline"
              onClick={() =>
                setSession((current) => ({ ...current, phase: "coding" }))
              }
            >
              Start coding
            </Button>
          ) : null}
          {!session.strict ? (
            <Button
              variant="outline"
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? "Resume" : "Pause"}
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() =>
              setSession((current) => ({ ...current, phase: "complete" }))
            }
          >
            End session
          </Button>
        </div>
      </div>

      {session.phase === "concept" ? (
        <Card className="mock-concept">
          <span>Rapid concept prompt</span>
          <h3>How does React decide when to re-render a component?</h3>
          <p>
            Aim for a 60–90 second spoken answer. Cover state, props, context,
            reconciliation, and avoiding unnecessary work.
          </p>
          <textarea
            aria-label="Concept answer notes"
            value={session.notes}
            onChange={(event) =>
              setSession((current) => ({
                ...current,
                notes: event.target.value,
              }))
            }
            placeholder="Capture only the points you missed…"
          />
        </Card>
      ) : (
        <div className="mock-grid">
          <div className="mock-main">
            <Card className="mock-question">
              <span>
                QUESTION {session.questionIndex + 1} OF {questions.length}
              </span>
              <h3>{question.title}</h3>
              <p>{question.statement}</p>
              <h4>Examples</h4>
              <ul>
                {question.examples.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <h4>Constraints</h4>
              <ul>
                {question.constraints.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <code>{question.signature}</code>
            </Card>
            <Card className="mock-editor">
              <label htmlFor="mock-scratchpad">Test-case scratchpad</label>
              <textarea
                id="mock-scratchpad"
                value={session.scratchpad}
                onChange={(event) =>
                  setSession((current) => ({
                    ...current,
                    scratchpad: event.target.value,
                  }))
                }
                placeholder="Write examples and edge cases before coding…"
              />
              <label htmlFor="mock-code">Candidate solution</label>
              <textarea
                id="mock-code"
                className="mock-code"
                value={session.code}
                onChange={(event) =>
                  setSession((current) => ({
                    ...current,
                    code: event.target.value,
                  }))
                }
                placeholder={question.signature}
              />
              <label htmlFor="mock-complexity">Complexity analysis</label>
              <input
                id="mock-complexity"
                value={session.complexity}
                onChange={(event) =>
                  setSession((current) => ({
                    ...current,
                    complexity: event.target.value,
                  }))
                }
                placeholder="Time O(…), space O(…)"
              />
              <div className="mock-actions">
                <Button
                  variant="outline"
                  onClick={() =>
                    setSession((current) => ({
                      ...current,
                      firstRunnableAt:
                        current.firstRunnableAt ?? current.activeSeconds,
                    }))
                  }
                >
                  Mark runnable
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setSession((current) => ({
                      ...current,
                      firstPassingAt:
                        current.firstPassingAt ?? current.activeSeconds,
                    }))
                  }
                >
                  Mark tests passing
                </Button>
              </div>
            </Card>
            <RevealPanel
              question={question}
              revealed={session.reveals}
              reveal={reveal}
              complexityReady={Boolean(session.complexity.trim())}
            />
          </div>
          <Card className="mock-coach">
            <span>COMMUNICATION COACH</span>
            <strong>{communicationScore}%</strong>
            {checklist.map((item) => (
              <label className="mock-check" key={item}>
                <input
                  type="checkbox"
                  checked={session.checklist.includes(item)}
                  onChange={() =>
                    setSession((current) => ({
                      ...current,
                      checklist: current.checklist.includes(item)
                        ? current.checklist.filter((entry) => entry !== item)
                        : [...current.checklist, item],
                    }))
                  }
                />
                {item}
              </label>
            ))}
          </Card>
        </div>
      )}
    </section>
  );
}

function RevealPanel({
  complexityReady,
  question,
  reveal,
  revealed,
}: {
  complexityReady: boolean;
  question: MockQuestion;
  reveal: (item: Reveal) => void;
  revealed: Reveal[];
}) {
  const items: Array<[Reveal, string, string]> = [
    ["clarifying", "Clarifying questions", question.clarifying],
    ["hint1", "Hint 1", question.hints[0]],
    ["hint2", "Hint 2", question.hints[1]],
    ["pattern", "Pattern", question.pattern],
    ["approach", "Approach", question.approach],
    ["solution", "Reference solution", question.solution],
    ["tests", "Reference tests", question.tests],
  ];
  return (
    <Card className="mock-reveals">
      <h3>Progressive reveals</h3>
      <div className="mock-reveal-buttons">
        {items.map(([id, label]) => (
          <Button
            key={id}
            variant="outline"
            disabled={
              revealed.includes(id) ||
              ((id === "solution" || id === "tests") && !complexityReady)
            }
            onClick={() => reveal(id)}
          >
            {revealed.includes(id) ? `${label} revealed` : `Reveal ${label}`}
          </Button>
        ))}
      </div>
      {!complexityReady ? (
        <p>
          Enter your complexity analysis before revealing solution or tests.
        </p>
      ) : null}
      {items
        .filter(([id]) => revealed.includes(id))
        .map(([id, label, content]) => (
          <section key={id}>
            <h4>{label}</h4>
            <pre>{content}</pre>
          </section>
        ))}
    </Card>
  );
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatMetric(seconds?: number): string {
  return seconds === undefined ? "not recorded" : formatTime(seconds);
}
