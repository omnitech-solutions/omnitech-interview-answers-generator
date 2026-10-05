// The live session's code draft as an editor canvas, like the Workspace's:
// tabs Solution | Usage | Tests, a CodeMirror editor (the Workspace's language
// support), copy per tab and for all, and a Run button that executes the three
// fields in order through the same runner the Workspace uses (/api/v1/run-all).
// The worker's own verification result is the first thing the Results panel
// shows; Run re-runs what the person edited.
//
// [SAFETY] The session's result is never overwritten while the person has
// unsaved edits: a newer revision is offered in a bar (Switch / Keep mine).
// Code is never logged and nothing leaves the page except the runner request.
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import type { Language, RunResult } from "@omnitech/interview-contracts";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../../icon";
import { studioFetch } from "../../studio-fetch";
import type { EditorFile } from "../../workspace/assistant-change";
import {
  languageExtensions,
  type RunState,
  summary,
  TestsTab,
} from "../../workspace/code-panel";
import { FILE_NAMES } from "../../workspace/stages";
import type { CodeResult } from "../session-results";
import { copyText } from "../shared/copy-text";

// One component, two densities: compact is the card (12px, pills, icon
// buttons, results as a one-line chip); maximized is the roomy view. Same
// editor theme, language support, highlighting and line numbers in both.
export type CanvasDensity = "compact" | "maximized";
type CanvasRunRequest = {
  language: Language;
  code: string;
  usageCode: string;
  testCode: string;
};
export type CanvasRunner = (request: CanvasRunRequest) => Promise<RunResult>;

const FILES: readonly { id: EditorFile; label: string }[] = [
  { id: "solution", label: "Solution" },
  { id: "usage", label: "Usage" },
  { id: "tests", label: "Tests" },
];
const LANGUAGES: readonly string[] = ["typescript", "react", "php", "ruby"];
const isLanguage = (value: string): value is Language =>
  LANGUAGES.includes(value);

// The Workspace's runner: all three fields, in order, in the language's
// container. The server's own message explains an unavailable runner.
const runAllRequest: CanvasRunner = async (request) => {
  const response = await studioFetch("/api/v1/run-all", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  } & Partial<RunResult>;
  if (!response.ok)
    throw new Error(body.error?.message ?? "The code could not be run.");
  return body as RunResult;
};

type Sources = Record<EditorFile, string>;
const sourcesOf = (result: CodeResult): Sources => ({
  solution: result.code,
  usage: result.usageCode,
  tests: result.testCode,
});
const keyOf = (result: CodeResult): string =>
  JSON.stringify([
    result.language,
    result.code,
    result.usageCode,
    result.testCode,
  ]);

// What the worker already established, in the shape a run has, so one
// presentation serves both.
function workerRun(result: CodeResult): RunState {
  if (result.tests.total === 0 && result.tests.results.length === 0)
    return { kind: "idle" };
  return {
    kind: "done",
    result: {
      stdout: "",
      stderr: "",
      exitCode: result.states.testsPassed ? 0 : 1,
      durationMs: result.runner.durationMs ?? 0,
      timedOut: result.runner.timedOut,
      tests: result.tests.results.map((test) => ({
        name: test.name,
        status: test.status,
      })),
    },
  };
}

type Pending = { result: CodeResult; revision: number | null };
type Origin = "worker" | "yours";

export function LiveCodeCanvas({
  result,
  revision = null,
  density = "compact",
  onCopy,
  runner = runAllRequest,
}: {
  result: CodeResult;
  // The task revision this result answers, for the "available" bar.
  revision?: number | null;
  density?: CanvasDensity;
  onCopy?(text: string): void | Promise<void>;
  runner?: CanvasRunner;
}) {
  const [base, setBase] = useState(result);
  const [edits, setEdits] = useState<Partial<Sources>>({});
  const [file, setFile] = useState<EditorFile>("solution");
  const [wrap, setWrap] = useState(false);
  const [run, setRun] = useState<RunState>(() => workerRun(result));
  const [origin, setOrigin] = useState<Origin>("worker");
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [resultsOpen, setResultsOpen] = useState(density === "maximized");
  const [panel, setPanel] = useState<"tests" | "output">("tests");
  const [copied, setCopied] = useState<string | null>(null);
  const runId = useRef(0);
  const editing = Object.keys(edits).length > 0;

  const baseSources = sourcesOf(base);
  const sources: Sources = { ...baseSources, ...edits };
  const names = isLanguage(base.language)
    ? FILE_NAMES[base.language]
    : { solution: "Solution", usage: "Usage", tests: "Tests" };

  // A result arrives: adopt it when nothing is edited; otherwise offer it.
  // Editing never loses to an arrival (the person's text is the newer fact).
  // The effect fires on an arrival only, so what it compares with is read
  // through a ref of the latest render's values.
  const arrived = keyOf(result);
  const now = useRef({ base, origin, editing, dismissed, revision });
  now.current = { base, origin, editing, dismissed, revision };
  useEffect(() => {
    const here = now.current;
    if (arrived === keyOf(here.base)) {
      // Same sources: only the verification facts may have moved.
      if (result !== here.base) {
        setBase(result);
        if (here.origin === "worker") {
          setRun(workerRun(result));
          setStale(false);
        }
      }
      setPending(null);
      return;
    }
    if (!here.editing) {
      runId.current += 1;
      setBase(result);
      setRun(workerRun(result));
      setOrigin("worker");
      setStale(false);
      setPending(null);
      return;
    }
    if (arrived !== here.dismissed)
      setPending({ result, revision: here.revision });
  }, [arrived, result]);

  // The source a file reverts to: the adopted result's own text.
  const change = useCallback(
    (which: EditorFile, text: string) => {
      setEdits((current) => {
        const next = { ...current };
        if (text === sourcesOf(base)[which]) delete next[which];
        else next[which] = text;
        return next;
      });
      setStale(true);
    },
    [base],
  );

  const flash = (label: string) => {
    setCopied(label);
    setTimeout(() => setCopied((now) => (now === label ? null : now)), 1500);
  };
  // "Copied" only after the write succeeded; a blocked clipboard says so.
  const copy = (label: string, text: string) => {
    void (async () => {
      const written = onCopy
        ? await Promise.resolve(onCopy(text)).then(
            () => true,
            () => false,
          )
        : await copyText(text);
      flash(written ? label : `failed:${label}`);
    })();
  };
  const copyLabel = (label: string, rest: string, done: string) =>
    copied === label
      ? done
      : copied === `failed:${label}`
        ? "Copy failed"
        : rest;
  const copyIcon = (label: string): IconName =>
    copied === label
      ? "check"
      : copied === `failed:${label}`
        ? "error"
        : "content_copy";
  const copyAll = () =>
    copy(
      "all",
      FILES.map((item) =>
        `// ${names[item.id]}\n${sources[item.id]}`.trimEnd(),
      ).join("\n\n"),
    );

  const language = isLanguage(base.language) ? base.language : null;
  const running = run.kind === "running";
  const execute = async () => {
    if (!language || running || !sources.solution.trim()) return;
    const id = ++runId.current;
    setRun({ kind: "running" });
    setResultsOpen(true);
    setPanel("tests");
    try {
      const outcome = await runner({
        language,
        code: sources.solution,
        usageCode: sources.usage,
        testCode: sources.tests,
      });
      if (id !== runId.current) return;
      setRun({ kind: "done", result: outcome });
      setOrigin("yours");
      setStale(false);
    } catch (error) {
      if (id !== runId.current) return;
      setRun({
        kind: "error",
        message:
          error instanceof Error && error.message
            ? error.message
            : "The code could not be run.",
      });
      setOrigin("yours");
    }
  };

  const switchTo = () => {
    if (!pending) return;
    runId.current += 1;
    setBase(pending.result);
    setEdits({});
    setRun(workerRun(pending.result));
    setOrigin("worker");
    setStale(false);
    setPending(null);
  };
  const keepMine = () => {
    if (pending) setDismissed(keyOf(pending.result));
    setPending(null);
  };

  const extensions = useMemo(
    () => [
      ...languageExtensions(
        isLanguage(base.language) ? base.language : "typescript",
      ),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      ...(wrap ? [EditorView.lineWrapping] : []),
    ],
    [base.language, wrap],
  );

  const edited = (which: EditorFile) => edits[which] !== undefined;
  const states = base.states;
  const failing =
    run.kind === "done"
      ? (run.result.tests ?? []).filter((test) => test.status === "failed")
      : [];
  const compact = density === "compact";
  const height = compact ? "240px" : "440px";
  const resultsSummary = summary(run);

  return (
    <section
      className="lc-canvas"
      data-density={density}
      data-edited={editing}
      aria-label="Code canvas"
    >
      {pending && (
        <div className="lc-revision" role="status" data-testid="revision-bar">
          <Icon name="history" size={15} />
          <span className="lc-revision-text">
            {pending.revision !== null
              ? `Revision ${pending.revision} available`
              : "A new revision is available"}
            {" · your edits are kept"}
          </span>
          <button type="button" className="lc-button" onClick={switchTo}>
            Switch
          </button>
          <button type="button" className="lc-button" onClick={keepMine}>
            Keep mine
          </button>
        </div>
      )}
      <div className="lc-bar">
        <div className="lc-tabs" role="tablist" aria-label="Code files">
          {FILES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={file === item.id}
              className="lc-tab"
              onClick={() => setFile(item.id)}
              title={names[item.id]}
            >
              {item.label}
              {edited(item.id) && (
                <span className="lc-dot" role="img" aria-label="edited" />
              )}
            </button>
          ))}
        </div>
        <span className="lc-spacer" />
        {editing && <span className="lc-edited">Edited</span>}
        {!compact && (
          <button
            type="button"
            className="lc-button"
            aria-pressed={wrap}
            onClick={() => setWrap(!wrap)}
          >
            Wrap
          </button>
        )}
        <button
          type="button"
          className="lc-button"
          aria-label={copyLabel(file, "Copy", "Copied")}
          title="Copy this file"
          onClick={() => copy(file, sources[file])}
        >
          <Icon name={copyIcon(file)} size={14} />
          {!compact && copyLabel(file, "Copy", "Copied")}
        </button>
        {!compact && (
          <button type="button" className="lc-button" onClick={copyAll}>
            <Icon name={copyIcon("all")} size={14} />
            {copyLabel("all", "Copy all", "Copied all")}
          </button>
        )}
        <button
          type="button"
          className="lc-button lc-run"
          aria-label={running ? "Running…" : "Run"}
          title="Run solution, usage and tests"
          disabled={!language || running}
          onClick={() => void execute()}
        >
          <Icon name="play_arrow" size={15} />
          {!compact && (running ? "Running…" : "Run")}
        </button>
      </div>
      <div className="lc-editor" data-testid="canvas-editor">
        <CodeMirror
          value={sources[file]}
          minHeight="140px"
          maxHeight={height}
          theme="dark"
          extensions={extensions}
          aria-label={`Edit ${names[file]}`}
          basicSetup={{ lineNumbers: true, foldGutter: false }}
          onChange={(text) => change(file, text)}
        />
      </div>
      <div className="lc-results" aria-label="Results">
        <button
          type="button"
          className="lc-results-head"
          aria-expanded={resultsOpen}
          aria-label={compact ? `Results: ${resultsSummary}` : undefined}
          onClick={() => setResultsOpen(!resultsOpen)}
        >
          <Icon name={resultsOpen ? "expand_more" : "expand_less"} size={16} />
          {!compact && <span className="lc-results-title">Results</span>}
          <span className="lc-results-summary" aria-live="polite">
            {run.kind === "running" && <span className="ws-spinner" />}
            {resultsSummary}
          </span>
          {!compact && origin === "worker" && run.kind === "done" && !stale && (
            <span className="lc-origin">
              {states.fullyVerified ? "Fully verified" : "Session run"}
            </span>
          )}
          {!compact && origin === "yours" && !stale && (
            <span className="lc-origin">Your run</span>
          )}
          {!compact && stale && run.kind !== "idle" && (
            <span className="lc-origin amber">Edited since this run</span>
          )}
        </button>
        {resultsOpen && (
          <div className="lc-results-body">
            <div
              className="lc-panel-tabs"
              role="tablist"
              aria-label="Result views"
            >
              {(
                [
                  ["tests", "Tests", failing.length],
                  ["output", "Output", 0],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={panel === id}
                  className="lc-tab"
                  onClick={() => setPanel(id)}
                >
                  {label}
                  {count > 0 && <span className="ws-badge">{count}</span>}
                </button>
              ))}
            </div>
            {panel === "tests" ? (
              run.kind === "idle" ? (
                <p className="ws-panel-note">
                  Nothing has run yet. Press Run to execute the solution, usage
                  and tests in order.
                </p>
              ) : (
                <TestsTab run={run} onGoTo={(which) => setFile(which)} />
              )
            ) : (
              <pre className="ws-output">
                {run.kind === "done"
                  ? run.result.stdout || run.result.stderr || "No output."
                  : "Run the code to see its output."}
              </pre>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
