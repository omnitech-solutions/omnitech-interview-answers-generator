"use client";

import { php } from "@codemirror/lang-php";
import { javascript } from "@codemirror/lang-javascript";
import { StreamLanguage } from "@codemirror/language";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import type {
  GeneratedAnswer,
  Language,
  LanguageSelection,
  RunResult,
  SavedAnswer,
} from "@omnitech/interview-contracts";
import type { PlaygroundSnapshot } from "@omnitech/interview-playground-control";
import CodeMirror from "@uiw/react-codemirror";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";

import { StudioButton, StudioTextarea } from "./studio-controls";

type InspectorPanel = "notes" | "output" | "saved";
type EditorTab = "solution" | "usage" | "tests";
type OutputTab = "solution" | "tests";

interface ExecutionOutput {
  solution?: RunResult;
  tests?: RunResult;
}

const panels: Array<{ id: InspectorPanel; label: string }> = [
  { id: "notes", label: "Notes" },
  { id: "output", label: "Output" },
  { id: "saved", label: "Saved" },
];

const editorTabs: Array<{ id: EditorTab; label: string }> = [
  { id: "solution", label: "Main Solution" },
  { id: "usage", label: "Usage / Output" },
  { id: "tests", label: "Tests" },
];

const languages: Array<{ id: LanguageSelection; label: string }> = [
  { id: "auto", label: "Auto-detect" },
  { id: "php", label: "PHP" },
  { id: "react", label: "React" },
  { id: "typescript", label: "TypeScript" },
  { id: "ruby", label: "Ruby" },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await response.json()) as T | { error: { message: string } };
  if (!response.ok) {
    throw new Error(
      "error" in (body as object)
        ? (body as { error: { message: string } }).error.message
        : "Request failed.",
    );
  }
  return body as T;
}

function languageExtension(language: Language | undefined) {
  if (language === "php") return [php()];
  if (language === "react")
    return [javascript({ jsx: true, typescript: true })];
  if (language === "typescript") return [javascript({ typescript: true })];
  if (language === "ruby") return [StreamLanguage.define(ruby)];
  return [];
}

function normalizeAnswer(
  answer: GeneratedAnswer | undefined,
): GeneratedAnswer | undefined {
  return answer ? { ...answer, usageCode: answer.usageCode ?? "" } : undefined;
}

export function Playground() {
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState<LanguageSelection>("auto");
  const [answer, setAnswer] = useState<GeneratedAnswer>();
  const [savedId, setSavedId] = useState<string>();
  const [notes, setNotes] = useState("");
  const [savedAnswers, setSavedAnswers] = useState<SavedAnswer[]>([]);
  const [savedPage, setSavedPage] = useState(0);
  const [panel, setPanel] = useState<InspectorPanel>("notes");
  const [output, setOutput] = useState<ExecutionOutput>({});
  const [outputTab, setOutputTab] = useState<OutputTab>("solution");
  const [preview, setPreview] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [editorTab, setEditorTab] = useState<EditorTab>("solution");
  const appliedControlRevision = useRef(-1);

  const loadSaved = useCallback(async () => {
    setSavedAnswers(await api<SavedAnswer[]>("/answers"));
    setSavedPage(0);
  }, []);

  const savedPageSize = 5;
  const savedPageCount = Math.max(
    1,
    Math.ceil(savedAnswers.length / savedPageSize),
  );
  const visibleSavedAnswers = savedAnswers.slice(
    savedPage * savedPageSize,
    (savedPage + 1) * savedPageSize,
  );

  async function deleteSaved(id: string) {
    setBusy(true);
    try {
      await api<{ deleted: boolean }>(`/answers/${id}`, { method: "DELETE" });
      if (savedId === id) setSavedId(undefined);
      await loadSaved();
      setStatus("Deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  useEffect(() => {
    let active = true;

    async function applyExternalControl() {
      try {
        const snapshot = await api<PlaygroundSnapshot>("/playground-control", {
          cache: "no-store",
        });
        if (!active || snapshot.revision <= appliedControlRevision.current) {
          return;
        }

        appliedControlRevision.current = snapshot.revision;
        setQuestion(snapshot.value.question);
        setLanguage(snapshot.value.language);
        setAnswer(
          normalizeAnswer(snapshot.value.answer as GeneratedAnswer | undefined),
        );
        setNotes(snapshot.value.notes);
        setPanel(snapshot.value.panel);
        setSavedId(undefined);
        setOutput({});
        setPreview("");
        setEditorTab("solution");
        if (snapshot.revision > 0) {
          setStatus(
            `Playground updated through the control API (revision ${snapshot.revision}).`,
          );
        }
      } catch {
        // The editor remains usable if its optional local control channel is
        // unavailable. The next poll retries without interrupting the user.
      }
    }

    void applyExternalControl();
    const interval = window.setInterval(() => {
      void applyExternalControl();
    }, 500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const extensions = useMemo(
    () => languageExtension(answer?.language),
    [answer?.language],
  );

  async function generate() {
    if (!question.trim()) {
      setStatus("Enter a question first.");
      return;
    }
    setBusy(true);
    setStatus("Generating the simplest correct answer…");
    try {
      const generated = await api<GeneratedAnswer>("/generate", {
        method: "POST",
        body: JSON.stringify({ question, language }),
      });
      setAnswer(normalizeAnswer(generated));
      setSavedId(undefined);
      setOutput({});
      setPreview("");
      setEditorTab("solution");
      setStatus("Draft generated. It has not been saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!answer) return;
    setBusy(true);
    try {
      const saved = await api<SavedAnswer>("/answers", {
        method: "POST",
        body: JSON.stringify({
          ...answer,
          id: savedId,
          question,
          notes,
        }),
      });
      setSavedId(saved.id);
      await loadSaved();
      setStatus("Saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!answer?.code) return;
    setBusy(true);
    setPanel("output");
    setOutput({});
    setOutputTab("solution");
    setStatus(
      answer.testCode.trim() ? "Running solution…" : "Running solution…",
    );

    const solutionPromise = api<RunResult>("/run", {
      method: "POST",
      body: JSON.stringify({
        language: answer.language === "react" ? "typescript" : answer.language,
        code: [answer.code, answer.usageCode]
          .filter((section) => section.trim())
          .join("\n\n"),
        stdin: "",
      }),
    });

    try {
      const solution = await solutionPromise;
      setOutput((current) => ({ ...current, solution }));
      setBusy(false);
      setStatus(
        answer.testCode.trim()
          ? "Solution ready. Tests running…"
          : "Run complete.",
      );
    } catch (error) {
      setBusy(false);
      setStatus(error instanceof Error ? error.message : String(error));
      return;
    }

    if (!answer.testCode.trim()) return;

    void api<RunResult>("/run-all", {
      method: "POST",
      body: JSON.stringify({
        language: answer.language,
        code: answer.code,
        usageCode: answer.usageCode,
        testCode: answer.testCode,
        stdin: "",
      }),
    })
      .then((tests) => {
        setOutput((current) => ({ ...current, tests }));
        setStatus("Run complete.");
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error));
      });
  }

  function openSaved(saved: SavedAnswer) {
    setQuestion(saved.question);
    setLanguage(saved.language);
    setAnswer(normalizeAnswer(saved));
    setSavedId(saved.id);
    setNotes(saved.notes);
    setOutput({});
    setPreview("");
    setEditorTab("solution");
    setStatus(`Opened “${saved.title}”.`);
  }

  function newPlayground() {
    setQuestion("");
    setLanguage("auto");
    setAnswer(undefined);
    setSavedId(undefined);
    setNotes("");
    setOutput({});
    setPreview("");
    setEditorTab("solution");
    setStatus("New unsaved playground.");
  }

  return (
    <main className="studio">
      <header className="topbar">
        <div>
          <p className="eyebrow">LOCAL AI WORKBENCH</p>
          <h1>Interview Answers Playground</h1>
        </div>
        <div className="toolbar">
          <label>
            <span>Language</span>
            <select
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as LanguageSelection)
              }
            >
              {languages.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <StudioButton
            variant="outline"
            onClick={newPlayground}
            disabled={busy}
          >
            New
          </StudioButton>
          <StudioButton onClick={generate} disabled={busy || !question.trim()}>
            {busy ? "Working…" : "Generate"}
          </StudioButton>
          <StudioButton
            variant="outline"
            onClick={save}
            disabled={busy || !answer}
          >
            Save
          </StudioButton>
          <StudioButton
            variant="outline"
            onClick={() => void run()}
            disabled={busy || !answer}
          >
            Run All
          </StudioButton>
        </div>
      </header>

      <section className="workspace">
        <div className="main-column">
          <section className="card question-card">
            <div className="section-heading">
              <div>
                <span className="step">01</span>
                <h2>Question</h2>
              </div>
              <span className="save-state">
                {savedId ? "Saved" : "Playground · unsaved"}
              </span>
            </div>
            <StudioTextarea
              aria-label="Interview question"
              placeholder="Paste a coding, React, API, debugging, or system-design question…"
              rows={8}
              value={question}
              onChange={setQuestion}
            />
          </section>

          <section className="card answer-card">
            <div className="section-heading">
              <div>
                <span className="step">02</span>
                <h2>{answer?.title ?? "Answer"}</h2>
              </div>
              {answer ? (
                <span className="language-chip">{answer.language}</span>
              ) : null}
            </div>

            {answer ? (
              <div className="answer-grid">
                <article className="markdown">
                  <ReactMarkdown>{answer.answerMarkdown}</ReactMarkdown>
                </article>
                <div className="editor-shell">
                  <div className="editor-tabs" role="tablist" aria-label="Code">
                    {editorTabs.map((tab) => (
                      <button
                        key={tab.id}
                        role="tab"
                        aria-selected={editorTab === tab.id}
                        className={editorTab === tab.id ? "active" : ""}
                        onClick={() => setEditorTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <CodeMirror
                    value={
                      editorTab === "solution"
                        ? answer.code
                        : editorTab === "usage"
                          ? answer.usageCode
                          : answer.testCode
                    }
                    height="430px"
                    extensions={extensions}
                    theme="dark"
                    aria-label={
                      editorTab === "solution"
                        ? "Editable main solution"
                        : editorTab === "usage"
                          ? "Editable usage and output"
                          : "Editable tests"
                    }
                    onChange={(source) =>
                      setAnswer({
                        ...answer,
                        ...(editorTab === "solution"
                          ? { code: source }
                          : editorTab === "usage"
                            ? { usageCode: source }
                            : { testCode: source }),
                      })
                    }
                  />
                </div>
              </div>
            ) : (
              <div className="empty">
                <strong>Your answer will appear here.</strong>
                <span>
                  Generation creates a draft. Saving is always an explicit
                  action.
                </span>
              </div>
            )}
          </section>
        </div>

        <aside className="inspector card">
          <nav className="panel-tabs" aria-label="Inspector panels">
            {panels.map((item) => (
              <button
                key={item.id}
                className={panel === item.id ? "active" : ""}
                onClick={() => setPanel(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {panel === "notes" ? (
            <StudioTextarea
              label="Private notes"
              description="Notes remain local and are stored only when you save."
              rows={18}
              value={notes}
              onChange={setNotes}
            />
          ) : null}

          {panel === "output" ? (
            <div className="output">
              <div
                className="output-tabs"
                role="tablist"
                aria-label="Run output"
              >
                <button
                  role="tab"
                  aria-selected={outputTab === "solution"}
                  className={outputTab === "solution" ? "active" : ""}
                  onClick={() => setOutputTab("solution")}
                >
                  Normal output
                </button>
                <button
                  role="tab"
                  aria-selected={outputTab === "tests"}
                  className={outputTab === "tests" ? "active" : ""}
                  onClick={() => setOutputTab("tests")}
                >
                  Test results
                </button>
              </div>
              {outputTab === "tests" && !output.tests ? (
                <div className="output-empty output-pending">
                  {answer?.testCode.trim()
                    ? "Tests are running…"
                    : "No tests supplied for this answer."}
                </div>
              ) : outputTab === "solution" && !output.solution ? (
                <div className="output-empty output-pending">
                  Running solution…
                </div>
              ) : (
                <>
                  {(() => {
                    const result =
                      outputTab === "tests" ? output.tests : output.solution;
                    if (!result) return null;
                    const failed = result.exitCode !== 0 || result.timedOut;
                    return (
                      <>
                        <div
                          className={`run-meta ${failed ? "run-failed" : "run-passed"}`}
                        >
                          {failed ? "Failed" : "Passed"} · exit{" "}
                          {String(result.exitCode)} · {result.durationMs}ms
                        </div>
                        <pre
                          className={failed ? "output-error" : "output-success"}
                        >
                          {result.stdout || result.stderr || "(no output)"}
                        </pre>
                      </>
                    );
                  })()}
                </>
              )}
              {!output.solution && !output.tests && !answer ? (
                <div className="empty compact">
                  Run a solution to see its output.
                </div>
              ) : null}
            </div>
          ) : null}

          {panel === "saved" ? (
            <div className="saved-list">
              {savedAnswers.length === 0 ? (
                <div className="empty compact">No saved answers yet.</div>
              ) : (
                <>
                  {visibleSavedAnswers.map((saved) => (
                    <div className="saved-item" key={saved.id}>
                      <button onClick={() => openSaved(saved)}>
                        <strong>{saved.title}</strong>
                        <span>
                          {saved.language} ·{" "}
                          {new Date(saved.updatedAt).toLocaleDateString()}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label="Delete saved answer"
                        onClick={() => void deleteSaved(saved.id)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                  {savedPageCount > 1 ? (
                    <div
                      className="saved-pagination"
                      aria-label="Saved answers pagination"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setSavedPage((page) => Math.max(0, page - 1))
                        }
                        disabled={savedPage === 0}
                      >
                        Previous
                      </button>
                      <span>
                        Page {savedPage + 1} of {savedPageCount}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setSavedPage((page) =>
                            Math.min(savedPageCount - 1, page + 1),
                          )
                        }
                        disabled={savedPage >= savedPageCount - 1}
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          <p className="status" role="status">
            {status}
          </p>
        </aside>
      </section>
    </main>
  );
}
