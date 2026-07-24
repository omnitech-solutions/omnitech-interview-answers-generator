"use client";

import { php } from "@codemirror/lang-php";
import { javascript } from "@codemirror/lang-javascript";
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

const panels: Array<{ id: InspectorPanel; label: string }> = [
  { id: "notes", label: "Notes" },
  { id: "output", label: "Output" },
  { id: "saved", label: "Saved" },
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
  return [];
}

export function Playground() {
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState<LanguageSelection>("auto");
  const [answer, setAnswer] = useState<GeneratedAnswer>();
  const [savedId, setSavedId] = useState<string>();
  const [notes, setNotes] = useState("");
  const [savedAnswers, setSavedAnswers] = useState<SavedAnswer[]>([]);
  const [panel, setPanel] = useState<InspectorPanel>("notes");
  const [output, setOutput] = useState<RunResult>();
  const [preview, setPreview] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const appliedControlRevision = useRef(-1);

  const loadSaved = useCallback(async () => {
    setSavedAnswers(await api<SavedAnswer[]>("/answers"));
  }, []);

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
        setAnswer(snapshot.value.answer ?? undefined);
        setNotes(snapshot.value.notes);
        setPanel(snapshot.value.panel);
        setSavedId(undefined);
        setOutput(undefined);
        setPreview("");
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
      setAnswer(generated);
      setSavedId(undefined);
      setOutput(undefined);
      setPreview("");
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
    setStatus(
      answer.language === "react" ? "Building preview…" : "Running code…",
    );
    try {
      if (answer.language === "react") {
        const result = await api<{ javascript: string }>("/react-preview", {
          method: "POST",
          body: JSON.stringify({ code: answer.code }),
        });
        const safeScript = result.javascript.replaceAll(
          "</script",
          "<\\/script",
        );
        setPreview(`<!doctype html><html><head><style>
          body { font: 15px system-ui; margin: 24px; color: #172033; }
          button, input { font: inherit; }
        </style></head><body><div id="root"></div><script>${safeScript}</script></body></html>`);
        setOutput(undefined);
      } else {
        setOutput(
          await api<RunResult>("/run", {
            method: "POST",
            body: JSON.stringify({
              language: answer.language,
              code: answer.code,
              stdin: "",
            }),
          }),
        );
        setPreview("");
      }
      setStatus("Run complete.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function openSaved(saved: SavedAnswer) {
    setQuestion(saved.question);
    setLanguage(saved.language);
    setAnswer(saved);
    setSavedId(saved.id);
    setNotes(saved.notes);
    setOutput(undefined);
    setPreview("");
    setStatus(`Opened “${saved.title}”.`);
  }

  function newPlayground() {
    setQuestion("");
    setLanguage("auto");
    setAnswer(undefined);
    setSavedId(undefined);
    setNotes("");
    setOutput(undefined);
    setPreview("");
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
            onClick={run}
            disabled={busy || !answer}
          >
            {answer?.language === "react" ? "Preview" : "Run"}
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
                  <div className="editor-label">Editable solution</div>
                  <CodeMirror
                    value={answer.code}
                    height="430px"
                    extensions={extensions}
                    theme="dark"
                    onChange={(code) => setAnswer({ ...answer, code })}
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
              {preview ? (
                <iframe
                  title="React solution preview"
                  sandbox="allow-scripts"
                  srcDoc={preview}
                />
              ) : output ? (
                <>
                  <div className="run-meta">
                    exit {String(output.exitCode)} · {output.durationMs}ms
                  </div>
                  <pre>{output.stdout || output.stderr || "(no output)"}</pre>
                </>
              ) : (
                <div className="empty compact">
                  Run a solution to see its output.
                </div>
              )}
            </div>
          ) : null}

          {panel === "saved" ? (
            <div className="saved-list">
              {savedAnswers.length === 0 ? (
                <div className="empty compact">No saved answers yet.</div>
              ) : (
                savedAnswers.map((saved) => (
                  <button key={saved.id} onClick={() => openSaved(saved)}>
                    <strong>{saved.title}</strong>
                    <span>
                      {saved.language} ·{" "}
                      {new Date(saved.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                ))
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
