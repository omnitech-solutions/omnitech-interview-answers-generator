import { javascript } from "@codemirror/lang-javascript";
import { php } from "@codemirror/lang-php";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import {
  defaultHighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { Decoration, EditorView } from "@codemirror/view";
import type {
  Diagnostic,
  Language,
  RunResult,
} from "@omnitech/interview-contracts";
import type { ProposalRecord } from "@omnitech-assistant/sdk";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../icon";
import { Resizer, useStoredSize } from "../resizer";
import {
  AssistantChangeBanner,
  type EditorFile,
  PreviewedCode,
  previewedChange,
} from "./assistant-change";
import { FILE_NAMES } from "./stages";

export type RunState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: RunResult }
  | { kind: "error"; message: string };
export type SyntaxState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "checked"; diagnostics: Diagnostic[] }
  | { kind: "unavailable" };
type PanelTab = "tests" | "output" | "problems";

const FILES: readonly { id: EditorFile; icon: IconName }[] = [
  { id: "solution", icon: "code" },
  { id: "usage", icon: "terminal" },
  { id: "tests", icon: "science" },
];

function languageExtensions(language: Language) {
  if (language === "php") return [php({ plain: true })];
  if (language === "react")
    return [javascript({ jsx: true, typescript: true })];
  if (language === "typescript") return [javascript({ typescript: true })];
  return [StreamLanguage.define(ruby)];
}

// Lines to mark: a failing test's line, or syntax problems.
function markedLines(lines: readonly number[], className: string) {
  return EditorView.decorations.of((view) =>
    Decoration.set(
      [...new Set(lines)]
        .filter((line) => line >= 1 && line <= view.state.doc.lines)
        .sort((a, b) => a - b)
        .map((line) =>
          Decoration.line({ class: className }).range(
            view.state.doc.line(line).from,
          ),
        ),
    ),
  );
}

function summary(run: RunState) {
  if (run.kind === "running") return "Running tests…";
  if (run.kind === "error") return "Couldn’t run";
  if (run.kind === "idle") return "Not run yet · ⌘↵";
  const { result } = run;
  if (result.timedOut) return "Timed out";
  const seconds = `${(result.durationMs / 1000).toFixed(1)} s`;
  if (!result.tests?.length)
    return `${result.exitCode === 0 ? "Passed" : "Failed"} · ${seconds}`;
  const passed = result.tests.filter((test) => test.status === "passed").length;
  return `${passed} / ${result.tests.length} passed · ${seconds}`;
}

export function CodePanel({
  language,
  sources,
  file,
  onFile,
  onChange,
  run,
  syntax,
  preview,
  focus,
  inContext,
  onGoTo,
}: {
  language: Language;
  sources: Record<EditorFile, string>;
  file: EditorFile;
  onFile(file: EditorFile): void;
  onChange(file: EditorFile, source: string): void;
  run: RunState;
  syntax: SyntaxState;
  preview: ProposalRecord | null;
  // A line to show, e.g. where a test failed.
  focus: { file: EditorFile; line: number } | null;
  inContext: boolean;
  onGoTo(file: EditorFile, line: number): void;
}) {
  const view = useRef<EditorView | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  // [STRATEGY] The results panel's height is the person's: drag the edge
  // above it. The code keeps at least 120px.
  const panelHeight = useStoredSize({
    storageKey: "interview-studio.results-height",
    initial: 240,
    min: 96,
    // Before layout (or when hidden) the panel measures 0; use the window.
    max: () =>
      (panel.current?.getBoundingClientRect().height || window.innerHeight) -
      160,
  });
  const [tab, setTab] = useState<PanelTab>("tests");
  // [STRATEGY] Results stay a one-line bar until there is something to read;
  // a run opens them.
  const [open, setOpen] = useState(run.kind !== "idle");
  const [copied, setCopied] = useState(false);
  const names = FILE_NAMES[language];
  const change = previewedChange(preview, file);
  const failing =
    run.kind === "done"
      ? (run.result.tests ?? []).filter((test) => test.status === "failed")
      : [];
  const problems = useMemo(
    () => (syntax.kind === "checked" ? syntax.diagnostics : []),
    [syntax],
  );

  // A run shows its results; the Tests tab is where they are read.
  useEffect(() => {
    if (run.kind === "running") {
      setTab("tests");
      setOpen(true);
    }
  }, [run.kind]);

  const extensions = useMemo(
    () => [
      ...languageExtensions(language),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      markedLines(
        problems.map((problem) => problem.line),
        "cm-syntax-error-line",
      ),
      markedLines(focus?.file === file ? [focus.line] : [], "cm-focus-line"),
    ],
    [language, problems, focus, file],
  );

  // Go to a line: select it and scroll it into the middle of the editor.
  useEffect(() => {
    const editor = view.current;
    if (!editor || !focus || focus.file !== file) return;
    if (focus.line > editor.state.doc.lines) return;
    const line = editor.state.doc.line(focus.line);
    editor.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
  }, [focus, file]);

  return (
    <div
      ref={panel}
      className={`ws-code${inContext ? " assistant-in-context" : ""}`}
    >
      <div className="ws-files" role="tablist" aria-label="Files">
        {FILES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={file === item.id}
            className="ws-file"
            onClick={() => onFile(item.id)}
          >
            <Icon name={item.icon} size={15} />
            {names[item.id]}
          </button>
        ))}
        <span className="ws-spacer" />
        <button
          type="button"
          className="ws-code-icon"
          aria-label={copied ? "Code copied" : "Copy code"}
          title={copied ? "Code copied" : "Copy code"}
          onClick={() =>
            void navigator.clipboard?.writeText(sources[file]).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          <Icon name={copied ? "check" : "content_copy"} size={16} />
        </button>
      </div>
      <AssistantChangeBanner />
      <div className="ws-editor">
        {change ? (
          <PreviewedCode change={change} />
        ) : (
          <CodeMirror
            value={sources[file]}
            height="100%"
            theme="dark"
            extensions={extensions}
            aria-label={`Edit ${names[file]}`}
            onCreateEditor={(editor) => {
              view.current = editor;
            }}
            onChange={(source) => onChange(file, source)}
          />
        )}
      </div>
      {open && (
        <Resizer
          label="Resize results"
          stored={panelHeight}
          grows="up"
          sizeFromPointer={(event) =>
            (panel.current?.getBoundingClientRect().bottom ?? 0) - event.clientY
          }
          className="ws-panel-resizer"
        />
      )}
      <section
        className="ws-panel"
        aria-label="Results"
        style={open ? { height: panelHeight.size } : undefined}
      >
        <div className="ws-panel-bar">
          <div
            role="tablist"
            aria-label="Result views"
            className="ws-panel-tabs"
          >
            {(
              [
                ["tests", "Tests", failing.length],
                ["output", "Output", 0],
                ["problems", "Problems", problems.length],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className="ws-panel-tab"
                onClick={() => {
                  setTab(id);
                  setOpen(true);
                }}
              >
                {label}
                {count > 0 && <span className="ws-badge">{count}</span>}
              </button>
            ))}
          </div>
          <span className="ws-spacer" />
          <span className="ws-panel-summary" aria-live="polite">
            {run.kind === "running" && <span className="ws-spinner" />}
            {summary(run)}
          </span>
          <button
            type="button"
            className="ws-code-icon"
            aria-label={open ? "Collapse results" : "Expand results"}
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? "expand_more" : "expand_less"} />
          </button>
        </div>
        {open && (
          <div className="ws-panel-body">
            {tab === "tests" && <TestsTab run={run} onGoTo={onGoTo} />}
            {tab === "output" && (
              <pre className="ws-output">
                {run.kind === "done"
                  ? run.result.stdout || run.result.stderr || "No output."
                  : "Run the tests to see their output."}
              </pre>
            )}
            {tab === "problems" && (
              <ProblemsTab syntax={syntax} file={names[file]} />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function TestsTab({
  run,
  onGoTo,
}: {
  run: RunState;
  onGoTo(file: EditorFile, line: number): void;
}) {
  if (run.kind === "idle")
    return (
      <p className="ws-panel-note">
        Tests haven’t run yet. Press <kbd>⌘↵</kbd> or Run tests.
      </p>
    );
  if (run.kind === "running") return <p className="ws-panel-note">Running…</p>;
  if (run.kind === "error")
    return (
      <p className="ws-panel-note" role="alert">
        {run.message}
      </p>
    );
  const { tests } = run.result;
  // Without a structured report, the framework's own output explains it.
  if (!tests?.length)
    return (
      <pre className="ws-output">
        {run.result.stdout || run.result.stderr || "No test output."}
      </pre>
    );
  return (
    <ul className="ws-tests" aria-label="Test results">
      {tests.map((test, index) => (
        <li key={`${index}:${test.name}`} className={`ws-test ${test.status}`}>
          <div className="ws-test-row">
            <Icon
              name={
                test.status === "passed"
                  ? "check_circle"
                  : test.status === "failed"
                    ? "cancel"
                    : "pending"
              }
              size={16}
            />
            <span className="ws-test-name">{test.name}</span>
            {test.durationMs !== undefined && (
              <span className="ws-test-ms">{test.durationMs} ms</span>
            )}
          </div>
          {test.status === "failed" && (
            <>
              {test.message && (
                <pre className="ws-test-error">{test.message}</pre>
              )}
              {test.location && (
                <button
                  type="button"
                  className="ws-test-action"
                  onClick={() =>
                    onGoTo(
                      test.location!.editor === "solution"
                        ? "solution"
                        : "tests",
                      test.location!.line,
                    )
                  }
                >
                  Go to line {test.location.line}
                  {test.location.editor === "solution" ? " (solution)" : ""}
                </button>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProblemsTab({ syntax, file }: { syntax: SyntaxState; file: string }) {
  if (syntax.kind === "checking")
    return <p className="ws-panel-note">Checking {file}…</p>;
  if (syntax.kind === "unavailable")
    return (
      <p className="ws-panel-note">
        The syntax checker is unavailable. Run the tests to check the code.
      </p>
    );
  if (syntax.kind === "checked" && syntax.diagnostics.length)
    return (
      <ul className="ws-tests" aria-label="Problems">
        {syntax.diagnostics.map((problem) => (
          <li
            key={`${problem.line}:${problem.column ?? 0}:${problem.message}`}
            className="ws-test failed"
          >
            <div className="ws-test-row">
              <Icon name="error" size={16} />
              <span className="ws-test-name">{problem.message}</span>
              <span className="ws-test-ms">
                {file}:{problem.line}
                {problem.column ? `:${problem.column}` : ""}
              </span>
            </div>
          </li>
        ))}
      </ul>
    );
  return (
    <p className="ws-panel-note">
      <Icon name="check_circle" size={16} /> No syntax problems · checked as you
      type
    </p>
  );
}
