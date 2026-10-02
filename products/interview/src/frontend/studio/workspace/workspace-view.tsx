import {
  type GeneratedAnswer,
  type LanguageSelection,
  type RunResult,
  routeQuestion,
  type SavedAnswer,
  type StageProgress,
} from "@omnitech/interview-contracts";
import type { HostHooks } from "@omnitech-assistant/react";
import type { AssistantClient, ProposalRecord } from "@omnitech-assistant/sdk";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ExampleTemplate } from "../../example-templates";
import { useStudio } from "../context";
import { Icon } from "../icon";
import type { EditorFile } from "./assistant-change";
import { CodePanel, type RunState, type SyntaxState } from "./code-panel";
import { NewQuestion } from "./new-question";
import { StagePane } from "./stage-panes";
import { LANGUAGE_LABELS, STAGES, stageIndex } from "./stages";
import { VersionsMenu } from "./versions-menu";
import {
  type Draft,
  PLACEHOLDER_QUESTION,
  type SaveState,
  useCanonicalDraft,
} from "./use-canonical-draft";

// The assistant connection and the question it is bound to.
export interface WorkspaceAssistant {
  client: AssistantClient;
  profileId: string;
  workspaceId: string;
  artifactId: string;
}

const SYNTAX_DELAY_MS = 500;
const START: StageProgress = { stage: "understand", clarified: [] };
const FILE_FIELD = {
  solution: "code",
  usage: "usageCode",
  tests: "testCode",
} as const;
const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Unsaved changes",
  conflict: "Changed elsewhere",
  error: "Not saved",
};

const firstLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean)
    ?.slice(0, 120) ?? "Interview question";

// A started answer the person writes themselves.
function blankAnswer(
  question: string,
  language: LanguageSelection,
): GeneratedAnswer {
  return {
    title: firstLine(question),
    language:
      language === "auto" ? routeQuestion(question, "auto").language : language,
    answerMarkdown: `## Question\n\n${question}`,
    code: "",
    usageCode: "",
    testCode: "",
  };
}

// The answer fields of a saved version (the list adds its own bookkeeping).
function answerOf(version: SavedAnswer): GeneratedAnswer {
  const { title, language, answerMarkdown, code, usageCode, testCode, guide } =
    version;
  return {
    title,
    language,
    answerMarkdown,
    code,
    usageCode,
    testCode,
    ...(guide ? { guide } : {}),
  };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      (result as { error?: { message?: string } }).error?.message ??
        `Request failed (${response.status}).`,
    );
  return result as T;
}

// The Workspace inside the studio: one question, walked through its stages,
// with its code and test results beside it.
export function WorkspaceView({
  assistant,
}: {
  assistant: WorkspaceAssistant;
}) {
  const studio = useStudio();
  const refreshLists = studio?.refreshLists;
  const canonical = useCanonicalDraft({
    workspaceId: assistant.workspaceId,
    artifactId: assistant.artifactId,
    ...(refreshLists
      ? { onLoaded: refreshLists, onRenamed: refreshLists }
      : {}),
  });
  const { draft, update } = canonical;
  const [file, setFile] = useState<EditorFile>("solution");
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [syntax, setSyntax] = useState<SyntaxState>({ kind: "idle" });
  const [focus, setFocus] = useState<{ file: EditorFile; line: number } | null>(
    null,
  );
  const [preview, setPreview] = useState<ProposalRecord | null>(null);
  const [context, setContext] = useState<readonly string[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [status, setStatus] = useState("");
  // A status is news, not state: it fades back to the save state.
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(""), 4_000);
    return () => clearTimeout(timer);
  }, [status]);

  const runTests = useCallback(async () => {
    if (!draft?.answer?.code.trim()) return;
    setRun({ kind: "running" });
    try {
      const result: RunResult = await canonical.runTests();
      setRun({ kind: "done", result });
    } catch (error) {
      setRun({
        kind: "error",
        message:
          error instanceof Error && error.message === "runner-unavailable"
            ? "The code runner is unavailable."
            : "Tests could not run.",
      });
    }
  }, [canonical, draft?.answer?.code]);

  // Lend the shell this draft: the docked assistant reads and proposes
  // against it, and ⌘↵ runs its tests. Hooks are read when they are called.
  const hooks = useRef<HostHooks>({});
  hooks.current = {
    prepareSend: canonical.flush,
    beforeApply: async () => {
      await canonical.flush();
    },
    onApplied: async (_receipt, captured) => {
      const shown = await canonical.reloadAfterAssistant(captured);
      setStatus(
        shown
          ? "Assistant change applied."
          : "Assistant change stored; your edits were kept. Reload to see it.",
      );
      refreshLists?.();
    },
    onReverted: async (record) => {
      const shown = await canonical.reloadAfterAssistant(
        record.proposal.origin,
      );
      if (shown) setStatus("Assistant change undone.");
    },
    onPreview: setPreview,
    onContextChange: (surfaces) => setContext(surfaces.map((item) => item.id)),
  };
  const runLatest = useRef(runTests);
  runLatest.current = runTests;
  const bindView = studio?.bindView;
  useEffect(() => {
    if (!bindView) return;
    const origin = canonical.origin;
    return bindView({
      origin,
      hooks,
      runTests: () => void runLatest.current(),
      reloadDraft: (artifact) => {
        if (origin?.artifactId !== artifact) return;
        void canonical
          .reloadAfterAssistant(origin)
          .then((shown) =>
            setStatus(
              shown
                ? "Updated from the Playground CLI."
                : "The Playground CLI updated this question; your edits were kept. Reload to see it.",
            ),
          );
      },
    });
  }, [bindView, canonical.origin]);

  // [STRATEGY] Check the open file's syntax shortly after typing stops; only
  // the newest check is shown.
  const source = draft?.answer?.[FILE_FIELD[file]] ?? "";
  const language = draft?.answer?.language;
  useEffect(() => {
    if (!language || !source.trim()) {
      setSyntax({ kind: "idle" });
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setSyntax({ kind: "checking" });
      postJson<RunResult>("/api/v1/syntax-check", {
        language,
        code: source,
      }).then(
        (result) =>
          active &&
          setSyntax({ kind: "checked", diagnostics: result.diagnostics ?? [] }),
        () => active && setSyntax({ kind: "unavailable" }),
      );
    }, SYNTAX_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [language, source]);

  const progress = draft?.progress ?? START;
  const setProgress = (
    patch: (current: StageProgress) => Partial<StageProgress>,
  ) =>
    update((current) => {
      const at = current.progress ?? START;
      return { progress: { ...at, ...patch(at) } };
    });
  const begin = (next: Pick<Draft, "question" | "answer">) =>
    update({ ...next, progress: { stage: "understand", clarified: [] } });

  const header = (content: ReactNode) =>
    studio?.headerSlot ? createPortal(content, studio.headerSlot) : null;

  if (!draft)
    return (
      <div className="studio-page">
        <p
          className="ws-loading"
          role={canonical.loadError ? "alert" : "status"}
        >
          {canonical.loadError
            ? `This question couldn’t be loaded (${canonical.loadError}).`
            : "Loading question…"}
        </p>
      </div>
    );

  const isNew =
    !draft.answer &&
    (!draft.question.trim() || draft.question === PLACEHOLDER_QUESTION);
  if (isNew)
    return (
      <>
        {header(<span className="ws-title">New question</span>)}
        <NewQuestion
          busy={drafting}
          error={draftError}
          onSolve={(question, selected) =>
            begin({ question, answer: blankAnswer(question, selected) })
          }
          onDraft={(question, selected) => {
            setDrafting(true);
            setDraftError("");
            postJson<GeneratedAnswer>("/api/v1/generate", {
              question,
              language: selected,
            })
              .then((answer) => begin({ question, answer }))
              .catch((error: unknown) =>
                setDraftError(
                  error instanceof Error ? error.message : "Drafting failed.",
                ),
              )
              .finally(() => setDrafting(false));
          }}
          onExample={(example: ExampleTemplate) =>
            begin({ question: example.question, answer: example.answer })
          }
        />
      </>
    );

  const answer = draft.answer;
  const guide = answer?.guide;
  const failing =
    run.kind === "done" &&
    (run.result.tests?.some((test) => test.status === "failed") ??
      run.result.exitCode !== 0);
  const current = stageIndex(progress.stage);
  const stage = STAGES[current] ?? STAGES[0]!;

  return (
    <div className="ws">
      {header(
        <>
          <div className="ws-heading">
            <span className="ws-title">
              {answer?.title ?? firstLine(draft.question)}
            </span>
            {answer && (
              <span className="ws-pill">
                {LANGUAGE_LABELS[answer.language]}
              </span>
            )}
          </div>
          <span className={`ws-save ${canonical.saveState}`} role="status">
            <Icon
              name={canonical.saveState === "saved" ? "cloud_done" : "pending"}
              size={15}
            />
            {status || SAVE_LABEL[canonical.saveState]}
          </span>
          {canonical.saveState === "conflict" && (
            <button
              type="button"
              className="studio-button"
              onClick={() => void canonical.reload()}
            >
              Reload
            </button>
          )}
          <VersionsMenu
            disabled={!answer}
            onSave={canonical.saveVersion}
            onList={canonical.listVersions}
            onRestore={(version) => update({ answer: answerOf(version) })}
          />
          <button
            type="button"
            className="studio-button ws-run"
            title="Run tests (⌘↵)"
            disabled={!answer?.code.trim() || run.kind === "running"}
            onClick={() => void runTests()}
          >
            <Icon name="play_arrow" filled />
            Run tests
            <kbd>⌘↵</kbd>
          </button>
        </>,
      )}
      <nav className="ws-stepper" aria-label="Stages">
        {STAGES.map((item, index) => {
          const warn = item.id === "test" && failing;
          const state =
            index === current
              ? "current"
              : warn
                ? "warn"
                : index < current
                  ? "done"
                  : "todo";
          return (
            <div key={item.id} className="ws-step-wrap">
              {index > 0 && <span className="ws-step-line" />}
              <button
                type="button"
                className={`ws-step ${state}`}
                aria-current={index === current ? "step" : undefined}
                onClick={() => setProgress(() => ({ stage: item.id }))}
              >
                <span className="ws-step-dot">
                  {state === "warn" ? (
                    <Icon name="priority_high" size={14} />
                  ) : state === "done" ? (
                    <Icon name="check" size={14} />
                  ) : (
                    index + 1
                  )}
                </span>
                {item.label}
              </button>
            </div>
          );
        })}
        <span className="ws-spacer" />
        <span className="ws-faint">{stage.hint}</span>
      </nav>
      <div className="ws-split">
        <StagePane
          stage={stage.id}
          question={draft.question}
          guide={guide}
          answerMarkdown={answer?.answerMarkdown}
          notes={draft.notes}
          clarified={progress.clarified}
          testResults={run.kind === "done" ? run.result.tests : undefined}
          inContext={context.includes("question") || context.includes("guide")}
          onStage={(next) => setProgress(() => ({ stage: next }))}
          onToggleClarified={(index) =>
            setProgress(({ clarified }) => ({
              clarified: clarified.includes(index)
                ? clarified.filter((value) => value !== index)
                : [...clarified, index].sort((a, b) => a - b),
            }))
          }
          onNotes={(notes) => update({ notes })}
        />
        {answer ? (
          <CodePanel
            language={answer.language}
            sources={{
              solution: answer.code,
              usage: answer.usageCode,
              tests: answer.testCode,
            }}
            file={file}
            onFile={(next) => {
              setFile(next);
              setFocus(null);
            }}
            onChange={(changed, text) =>
              update((current) =>
                current.answer
                  ? {
                      answer: {
                        ...current.answer,
                        [FILE_FIELD[changed]]: text,
                      },
                    }
                  : {},
              )
            }
            run={run}
            syntax={syntax}
            preview={preview}
            focus={focus}
            inContext={
              preview !== null ||
              context.some((id) =>
                ["code", "usageCode", "testCode"].includes(id),
              )
            }
            onGoTo={(target, line) => {
              setFile(target);
              setFocus({ file: target, line });
            }}
          />
        ) : (
          <div className="ws-code ws-code-empty">
            <p>This question has no answer yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
