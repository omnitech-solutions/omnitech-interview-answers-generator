"use client";

import { javascript } from "@codemirror/lang-javascript";
import { php } from "@codemirror/lang-php";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { Decoration, EditorView } from "@codemirror/view";
import {
  App,
  Badge,
  Button,
  Card,
  CardDescription,
  ConfigProvider,
  IconButton,
} from "@oc-tech/omni-ui-components";
import type {
  GeneratedAnswer,
  Language,
  LanguageSelection,
  RunResult,
  SavedAnswer,
} from "@omnitech/interview-contracts";
import type { PlaygroundSnapshot } from "@omnitech/interview-playground-control";
import type { ProductPageProps } from "@omnitech/platform-contracts";
import CodeMirror from "@uiw/react-codemirror";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createAgentJob,
  type ExecutionTarget,
  executionTargets,
} from "./agent-jobs";
import { type ConceptDraft, ConceptLab } from "./concept-lab";
import { formatTimestamp } from "./format-timestamp";
import { InterviewPreparation } from "./interview-preparation";
import { MarkdownContent } from "./markdown-content";
import { exampleTemplates as preparedExampleTemplates } from "./example-templates";
import { MockInterview } from "./mock-interview";
import { StudioTextarea } from "./studio-controls";
import { InspectorToggleButton, StudioInspector } from "./studio-inspector";
import {
  NavigationToggle,
  StudioBrand,
  StudioNavigation,
  ThemeToggle,
  useStudioTheme,
} from "./studio-shell";
import { TerminalDock, TerminalToggleButton } from "./terminal-dock";

type InspectorPanel = "notes" | "output" | "saved";
type EditorTab = "solution" | "usage" | "tests";
type OutputTab = "solution" | "tests";
type QuestionTab = "input" | "preview";
type SyntaxState = "idle" | "checking" | "valid" | "invalid" | "unavailable";
type AnswerProvider = "" | ExecutionTarget["id"];

const WORD_WRAP_STORAGE_KEY = "interview-playground.word-wrap";
const DRAFT_STORAGE_KEY = "interview-playground.draft";
const AGENT_JOB_PATTERN = /^[0-9a-f-]{36}$/i;
const PHP_EDITOR_PREFIX = "<?php\n";

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
  if (language === "ruby") return [];
  return [];
}

function syntaxErrorLineExtension(lineNumber: number | undefined) {
  if (!lineNumber) return [];
  return EditorView.decorations.of((view) =>
    syntaxErrorLineDecorations(view, lineNumber),
  );
}

function syntaxErrorLineDecorations(
  view: EditorView,
  lineNumber: number | undefined,
) {
  if (!lineNumber || lineNumber > view.state.doc.lines) return Decoration.none;
  const line = view.state.doc.line(lineNumber);
  return Decoration.set([
    Decoration.line({ class: "cm-syntax-error-line" }).range(line.from),
  ]);
}

function normalizeAnswer(
  answer: GeneratedAnswer | undefined,
): GeneratedAnswer | undefined {
  if (!answer) return undefined;
  if (answer.language !== "react") {
    return { ...answer, usageCode: answer.usageCode ?? "" };
  }

  let testCode = answer.testCode ?? "";
  testCode = testCode
    .replace(
      /expect\((await screen\.findByRole\([^;]+?\))\)\.toHaveAttribute\(([^,]+),\s*([^\)]+)\)/g,
      "expect(($1).getAttribute($2)).toBe($3)",
    )
    .replace(
      /expect\((await screen\.findByRole\([^;]+?\))\)\.toHaveTextContent\(([^\)]+)\)/g,
      "expect(($1).textContent).toContain($2)",
    );
  if (
    (testCode.includes("@testing-library/react") ||
      testCode.includes("render(")) &&
    !testCode.includes("afterEach(cleanup)")
  ) {
    const imports = [
      testCode.includes("cleanup")
        ? ""
        : "import { cleanup } from '@testing-library/react';",
      testCode.includes("afterEach")
        ? ""
        : "import { afterEach } from 'vitest';",
    ]
      .filter(Boolean)
      .join("\n");
    testCode = `${imports}${imports ? "\n" : ""}afterEach(cleanup);\n\n${testCode}`;
  }

  return { ...answer, usageCode: answer.usageCode ?? "", testCode };
}

function syntaxLineNumber(raw: string): number | undefined {
  const match =
    raw.match(/:(\d+)(?::\d+)?(?=\s|:|$)/) ?? raw.match(/\bline\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

export function Workspace({
  onPreparationDirtyChange,
}: {
  onPreparationDirtyChange?: (dirty: boolean) => void;
} & Partial<ProductPageProps> = {}) {
  const [activeView, setActiveView] = useState<
    "playground" | "concept-lab" | "mock-interview" | "interview-preparation"
  >("playground");
  const preparationDirty = useRef(false);
  const [pendingView, setPendingView] = useState<
    "playground" | "concept-lab" | "mock-interview" | "interview-preparation"
  >();
  const preparationChanged = useCallback(
    (dirty: boolean) => {
      preparationDirty.current = dirty;
      onPreparationDirtyChange?.(dirty);
    },
    [onPreparationDirtyChange],
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [externalConcepts, setExternalConcepts] = useState<ConceptDraft[]>([]);
  const [externalMockControl, setExternalMockControl] =
    useState<PlaygroundSnapshot["value"]["mockInterview"]>();
  const { theme, toggleTheme } = useStudioTheme();
  const [question, setQuestion] = useState("");
  const [refinementRequest, setRefinementRequest] = useState("");
  const [answerProvider, setAnswerProvider] = useState<AnswerProvider>("");
  const [language, setLanguage] = useState<LanguageSelection>("auto");
  const [answer, setAnswer] = useState<GeneratedAnswer>();
  const [savedId, setSavedId] = useState<string>();
  const [notes, setNotes] = useState("");
  const [savedAnswers, setSavedAnswers] = useState<SavedAnswer[]>([]);
  const [savedPage, setSavedPage] = useState(0);
  const [panel, setPanel] = useState<InspectorPanel>("output");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [playgroundTerminalSession, setPlaygroundTerminalSession] =
    useState("workspace");
  const setInspectorVisibility = useCallback((open: boolean) => {
    setInspectorOpen(open);
    if (!open) setTerminalOpen(false);
  }, []);
  const toggleInspector = useCallback(() => {
    setInspectorOpen((current) => {
      const nextOpen = !current;
      if (!nextOpen) setTerminalOpen(false);
      return nextOpen;
    });
  }, []);
  useEffect(() => {
    if (terminalOpen && !inspectorOpen) setInspectorOpen(true);
  }, [inspectorOpen, terminalOpen]);
  const [conceptToolbarTarget, setConceptToolbarTarget] =
    useState<HTMLDivElement | null>(null);
  const [output, setOutput] = useState<ExecutionOutput>({});
  const [outputTab, setOutputTab] = useState<OutputTab>("solution");
  const [copiedOutput, setCopiedOutput] = useState<OutputTab>();
  const [copiedCode, setCopiedCode] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [preview, setPreview] = useState("");
  const [previewState, setPreviewState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [previewError, setPreviewError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [editorTab, setEditorTab] = useState<EditorTab>("solution");
  const [syntaxState, setSyntaxState] = useState<SyntaxState>("idle");
  const [syntaxMessage, setSyntaxMessage] = useState("");
  const [exampleId, setExampleId] = useState("");
  const [questionTab, setQuestionTab] = useState<QuestionTab>("input");
  const localEdits = useRef(false);
  const draftHydrated = useRef(false);
  const syntaxRequestId = useRef(0);
  const previewRequestId = useRef(0);
  const appliedControlRevision = useRef(-1);

  useEffect(() => {
    const requestedView = new URLSearchParams(window.location.search).get(
      "view",
    );
    if (
      requestedView === "concept-lab" ||
      requestedView === "mock-interview" ||
      requestedView === "interview-preparation"
    )
      setActiveView(requestedView);
  }, []);

  function selectWorkspace(
    view:
      | "playground"
      | "concept-lab"
      | "mock-interview"
      | "interview-preparation",
  ) {
    if (
      activeView === "interview-preparation" &&
      preparationDirty.current &&
      view !== activeView
    ) {
      setPendingView(view);
      return;
    }
    setActiveView(view);
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(window.location.search)), view }).toString()}`,
    );
  }

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

  async function copyOutput(tab: OutputTab, result: RunResult) {
    const text = result.stdout || result.stderr || "(no output)";
    try {
      await navigator.clipboard.writeText(text);
      setCopiedOutput(tab);
      setStatus(
        `${tab === "tests" ? "Test results" : "Normal output"} copied.`,
      );
      window.setTimeout(() => setCopiedOutput(undefined), 1500);
    } catch {
      setStatus("Couldn’t copy output. Check clipboard permissions.");
    }
  }

  async function copyEditorCode() {
    try {
      await navigator.clipboard.writeText(editorValue);
      setCopiedCode(true);
      setStatus("Code copied.");
      window.setTimeout(() => setCopiedCode(false), 1500);
    } catch {
      setStatus("Couldn’t copy code. Check clipboard permissions.");
    }
  }

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  useEffect(() => {
    setWordWrap(window.localStorage.getItem(WORD_WRAP_STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    if (answer?.language !== "react" || !answer.code.trim()) {
      setPreview("");
      setPreviewState("idle");
      setPreviewError("");
      return;
    }

    const requestId = ++previewRequestId.current;
    setPreviewState("loading");
    setPreviewError("");
    const componentName =
      answer.code.match(
        /(?:export\s+(?:default\s+)?)?function\s+([A-Z][A-Za-z0-9_]*)/,
      )?.[1] ?? "App";
    void api<{ javascript: string }>("/react-preview", {
      method: "POST",
      body: JSON.stringify({ code: answer.code, componentName }),
    })
      .then((result) => {
        if (requestId !== previewRequestId.current) return;
        setPreview(result.javascript);
        setPreviewState("ready");
      })
      .catch((error) => {
        if (requestId !== previewRequestId.current) return;
        setPreview("");
        setPreviewState("error");
        setPreviewError(
          error instanceof Error ? error.message : "React preview failed.",
        );
      });
  }, [answer?.code, answer?.language]);

  useEffect(() => {
    const storedDraft = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (storedDraft) {
      try {
        const draft = JSON.parse(storedDraft) as {
          question?: string;
          language?: LanguageSelection;
          answer?: GeneratedAnswer;
          answerProvider?: AnswerProvider;
          notes?: string;
          refinementRequest?: string;
          terminalSession?: unknown;
        };
        if (draft.question || draft.answer) {
          localEdits.current = true;
          setQuestion(draft.question ?? "");
          setAnswerProvider(
            ["", ...executionTargets.map((target) => target.id)].includes(
              draft.answerProvider ?? "",
            )
              ? (draft.answerProvider as AnswerProvider)
              : "",
          );
          setLanguage(draft.language ?? "auto");
          setAnswer(normalizeAnswer(draft.answer));
          setNotes(draft.notes ?? "");
          setRefinementRequest(draft.refinementRequest ?? "");
          if (
            typeof draft.terminalSession === "string" &&
            AGENT_JOB_PATTERN.test(draft.terminalSession)
          ) {
            setPlaygroundTerminalSession(draft.terminalSession);
          }
        }
      } catch {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
    }
    draftHydrated.current = true;
  }, []);

  useEffect(() => {
    if (!draftHydrated.current) return;
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        question,
        answerProvider,
        language,
        answer,
        notes,
        refinementRequest,
        terminalSession: playgroundTerminalSession,
      }),
    );
  }, [
    answer,
    answerProvider,
    language,
    notes,
    playgroundTerminalSession,
    question,
    refinementRequest,
  ]);

  function toggleWordWrap() {
    setWordWrap((current) => {
      const next = !current;
      window.localStorage.setItem(WORD_WRAP_STORAGE_KEY, String(next));
      return next;
    });
  }

  useEffect(() => {
    let active = true;

    async function applyExternalControl() {
      try {
        const snapshot = await api<PlaygroundSnapshot>("/playground-control", {
          cache: "no-store",
        });
        if (
          !active ||
          preparationDirty.current ||
          snapshot.revision <= appliedControlRevision.current ||
          (localEdits.current && snapshot.revision === 0)
        ) {
          return;
        }

        appliedControlRevision.current = snapshot.revision;
        setQuestion(snapshot.value.question);
        setLanguage(snapshot.value.language);
        setAnswer(
          normalizeAnswer(snapshot.value.answer as GeneratedAnswer | undefined),
        );
        setRefinementRequest("");
        setExampleId("");
        setNotes(snapshot.value.notes);
        if (snapshot.revision > 0)
          setActiveView(snapshot.value.view ?? "playground");
        setExternalConcepts(
          snapshot.value.explanations ??
            (snapshot.value.explanation ? [snapshot.value.explanation] : []),
        );
        setExternalMockControl(snapshot.value.mockInterview);
        const nextPanel: InspectorPanel =
          snapshot.value.panel === "notes" || snapshot.value.panel === "saved"
            ? snapshot.value.panel
            : "output";
        setPanel(nextPanel);
        if (snapshot.revision > 0 && snapshot.value.panel === "terminal") {
          setTerminalOpen(true);
        }
        setSavedId(undefined);
        setOutput({});
        setPreview("");
        setEditorTab("solution");
        setSyntaxState("idle");
        setSyntaxMessage("");
        if (snapshot.revision > 0) {
          setStatus(
            `Workspace updated through the control API (revision ${snapshot.revision}).`,
          );
        }
      } catch {
        // The editor remains usable if its optional local control channel is
        // unavailable. The next poll retries without interrupting the user.
      }
    }

    void applyExternalControl();
    // A hidden tab has nobody watching it; resume with an immediate poll.
    const interval = window.setInterval(() => {
      if (!document.hidden) void applyExternalControl();
    }, 500);
    const resume = () => {
      if (!document.hidden) void applyExternalControl();
    };
    document.addEventListener("visibilitychange", resume);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  const extensions = useMemo(
    () => languageExtension(answer?.language),
    [answer?.language],
  );
  const editorSource = answer
    ? editorTab === "solution"
      ? answer.code
      : editorTab === "usage"
        ? answer.usageCode
        : answer.testCode
    : "";
  // Keep the language extension active while invalid so syntax colours remain useful.
  const syntaxErrorLine =
    syntaxState === "invalid" ? syntaxLineNumber(syntaxMessage) : undefined;
  const editorExtensions = useMemo(
    () => [
      ...extensions,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      syntaxErrorLineExtension(syntaxErrorLine),
    ],
    [extensions, syntaxErrorLine],
  );
  const addsPhpEditorPrefix =
    answer?.language === "php" &&
    editorTab !== "solution" &&
    !editorSource.trimStart().startsWith("<?php");
  const editorValue = addsPhpEditorPrefix
    ? `${PHP_EDITOR_PREFIX}${editorSource}`
    : editorSource;
  useEffect(() => {
    if (!answer || !editorValue.trim()) return;

    const timer = window.setTimeout(() => {
      void checkSyntax(editorTab);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [answer?.language, editorTab, editorValue]);

  async function generateAnswer(
    questionValue: string,
    languageValue: LanguageSelection,
    providerId?: "openai" | "lm-studio",
  ): Promise<GeneratedAnswer> {
    const generated = await api<GeneratedAnswer>("/generate", {
      method: "POST",
      body: JSON.stringify({
        question: questionValue,
        language: languageValue,
        ...(providerId === undefined ? {} : { providerId }),
      }),
    });
    return normalizeAnswer(generated) as GeneratedAnswer;
  }

  async function generate(mode: "new" | "refine" = "new") {
    localEdits.current = true;
    const refinement = mode === "refine" ? refinementRequest.trim() : "";
    if (
      !question.trim() ||
      !answerProvider ||
      (mode === "refine" && (!answer || !refinement))
    ) {
      setStatus(
        mode === "refine"
          ? "Enter the change you want to apply."
          : "Enter a question first.",
      );
      return;
    }
    if (mode === "new") setRefinementRequest("");
    const target = executionTargets.find(
      (candidate) => candidate.id === answerProvider,
    );
    if (!target) return;
    setBusy(true);
    setStatus(
      target.family === "agent-runtime"
        ? "Starting an isolated agent job…"
        : "Generating the simplest correct answer…",
    );
    try {
      if (target.family === "agent-runtime") {
        const job = await createAgentJob({
          profileId: target.profileId,
          prompt:
            mode === "refine" && answer
              ? `Original question:\n${question}\n\nCurrent answer:\n${JSON.stringify(
                  { ...answer, notes },
                )}\n\nRequested change:\n${refinement}\n\nReturn the complete revised answer using the required structured answer schema.`
              : question.trim(),
        });
        setPlaygroundTerminalSession(job.id);
        setTerminalOpen(true);
        setInspectorOpen(true);
        setStatus(
          `Agent job “${job.id}” started. Progress is available in the terminal drawer.`,
        );
        return;
      }
      const generationQuestion =
        mode === "refine" && answer && refinement
          ? `Original question:\n${question}\n\nCurrent answer:\n${JSON.stringify(
              { ...answer, notes },
            )}\n\nRequested change:\n${refinement}\n\nReturn the complete revised answer.`
          : question;
      setAnswer(
        await generateAnswer(generationQuestion, language, target.providerId),
      );
      setRefinementRequest("");
      setExampleId("");
      setSavedId(undefined);
      setOutput({});
      setPreview("");
      setEditorTab("solution");
      setSyntaxState("idle");
      setSyntaxMessage("");
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
    setInspectorOpen(true);
    setOutput({});
    setOutputTab("solution");
    setStatus(
      answer.testCode.trim() ? "Running solution…" : "Running solution…",
    );

    if (answer.language === "react" && answer.testCode.trim()) {
      setOutput({
        solution: {
          stdout: "React solutions run in the Vitest test environment.",
          stderr: "",
          exitCode: 0,
          durationMs: 0,
          timedOut: false,
        },
      });
      setOutputTab(answer.testCode.trim() ? "tests" : "solution");
      if (!answer.testCode.trim()) {
        setBusy(false);
        setStatus(
          "React solution ready. Add tests to validate it with Vitest.",
        );
        return;
      }

      setStatus("React solution ready. Tests running…");
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
          setBusy(false);
          setStatus("Run complete.");
        })
        .catch((error) => {
          setBusy(false);
          setStatus(error instanceof Error ? error.message : String(error));
        });
      return;
    }

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
    localEdits.current = true;
    setQuestion(saved.question);
    setLanguage(saved.language);
    setAnswer(normalizeAnswer(saved));
    setSavedId(saved.id);
    setNotes(saved.notes);
    setOutput({});
    setPreview("");
    setQuestionTab("input");
    setEditorTab("solution");
    setStatus(`Opened “${saved.title}”.`);
  }

  async function newPlayground() {
    localEdits.current = false;
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    setQuestion("");
    setRefinementRequest("");
    setAnswerProvider("");
    setLanguage("auto");
    setAnswer(undefined);
    setSavedId(undefined);
    setNotes("");
    setOutput({});
    setPreview("");
    setEditorTab("solution");
    setSyntaxState("idle");
    setSyntaxMessage("");
    setExampleId("");
    setQuestionTab("input");
    setPanel("output");
    setPlaygroundTerminalSession("workspace");
    setTerminalOpen(false);
    setInspectorOpen(false);
    try {
      const snapshot = await api<PlaygroundSnapshot>("/playground-control", {
        method: "PATCH",
        body: JSON.stringify({
          view: "playground",
          question: "",
          language: "auto",
          answer: null,
          notes: "",
          panel: "output",
        }),
      });
      appliedControlRevision.current = snapshot.revision;
      setStatus("New unsaved workspace.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Workspace cleared locally. ${error.message}`
          : "Workspace cleared locally.",
      );
    }
  }

  async function checkSyntax(tab: EditorTab) {
    if (!answer) return;
    const source =
      tab === "solution"
        ? answer.code
        : [answer.code, tab === "usage" ? answer.usageCode : answer.testCode]
            .filter((section) => section.trim())
            .join("\n\n");
    if (!source.trim()) return;

    const requestId = ++syntaxRequestId.current;
    setSyntaxState("checking");
    setSyntaxMessage("");
    try {
      const result = await api<RunResult>("/syntax-check", {
        method: "POST",
        body: JSON.stringify({ language: answer.language, code: source }),
      });
      if (requestId !== syntaxRequestId.current) return;
      const diagnostic = result.stderr || result.stdout;
      setSyntaxState(result.exitCode === 0 ? "valid" : "invalid");
      setSyntaxMessage(diagnostic.trim());
    } catch (error) {
      if (requestId !== syntaxRequestId.current) return;
      setSyntaxState("unavailable");
      setSyntaxMessage(
        error instanceof Error ? error.message : "Syntax check unavailable.",
      );
    }
  }

  function selectExample(selected: string) {
    localEdits.current = true;
    setExampleId(selected);
    const template = preparedExampleTemplates.find(
      (item) => item.id === selected,
    );
    if (!template) return;
    setQuestion(template.question);
    setLanguage(template.language);
    setAnswer(template.answer);
    setSavedId(undefined);
    setOutput({});
    setPreview("");
    setQuestionTab("input");
    setEditorTab("solution");
    setSyntaxState("idle");
    setSyntaxMessage("");
    setStatus(
      `${template.label} loaded with solution and tests. Generate to refresh it through the API.`,
    );
  }

  const page = (
    <ConfigProvider theme={{ mode: theme }}>
      <App>
        <main className="studio">
          <header
            className={`topbar ${
              activeView !== "playground" ? "topbar-concept" : ""
            }`}
          >
            <NavigationToggle
              open={navigationOpen}
              onClick={() => setNavigationOpen((open) => !open)}
            />
            <StudioBrand />
            {activeView === "playground" ? (
              <label className="topbar-example">
                <span>Example template</span>
                <select
                  aria-label="Example template"
                  value={exampleId}
                  onChange={(event) => selectExample(event.target.value)}
                >
                  <option value="">Choose a realistic example…</option>
                  {preparedExampleTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="topbar-view-title">
                {activeView === "interview-preparation"
                  ? "Interview preparation"
                  : activeView === "concept-lab"
                    ? "Briefing"
                    : "Rehearsal"}
              </div>
            )}
            {activeView === "playground" ? (
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
                <Button
                  variant="outline"
                  onClick={() => void newPlayground()}
                  disabled={busy}
                >
                  New
                </Button>
                <Button
                  variant="outline"
                  onClick={save}
                  disabled={busy || !answer}
                >
                  Save
                </Button>
                <span className="toolbar-divider" aria-hidden="true" />
                <Button
                  className="run-button"
                  variant="outline"
                  onClick={() => void run()}
                  disabled={busy || !answer}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M8 5.5v13l10-6.5z" />
                  </svg>
                  Run All
                </Button>
                <span className="toolbar-divider" aria-hidden="true" />
                <TerminalToggleButton
                  open={terminalOpen}
                  onToggle={() => {
                    setTerminalOpen((current) => {
                      const nextOpen = !current;
                      if (nextOpen) setInspectorOpen(true);
                      return nextOpen;
                    });
                  }}
                />
                <ThemeToggle theme={theme} onClick={toggleTheme} />
                <InspectorToggleButton
                  open={inspectorOpen}
                  onToggle={toggleInspector}
                />
              </div>
            ) : activeView === "concept-lab" ? (
              <div className="toolbar concept-toolbar">
                <div
                  className="concept-toolbar-actions"
                  ref={setConceptToolbarTarget}
                />
                <span className="toolbar-divider" aria-hidden="true" />
                <TerminalToggleButton
                  open={terminalOpen}
                  onToggle={() => {
                    setTerminalOpen((current) => {
                      const nextOpen = !current;
                      if (nextOpen) setInspectorOpen(true);
                      return nextOpen;
                    });
                  }}
                />
                <ThemeToggle theme={theme} onClick={toggleTheme} />
                <InspectorToggleButton
                  open={inspectorOpen}
                  onToggle={toggleInspector}
                />
              </div>
            ) : (
              <div />
            )}
          </header>

          {navigationOpen ? (
            <StudioNavigation
              active={activeView}
              onSelect={selectWorkspace}
              onClose={() => setNavigationOpen(false)}
            />
          ) : null}

          {pendingView && (
            <div
              role="dialog"
              aria-label="Unsaved preparation"
              className="concept-answer-card"
            >
              <p>
                Your preparation has unsaved changes. Stay to Save, or discard
                local changes and leave.
              </p>
              <button type="button" onClick={() => setPendingView(undefined)}>
                Stay and save
              </button>
              <button
                type="button"
                onClick={() => {
                  preparationChanged(false);
                  selectWorkspace(pendingView);
                  setPendingView(undefined);
                }}
              >
                Discard and leave
              </button>
            </div>
          )}
          {activeView === "interview-preparation" ? (
            <InterviewPreparation
              artifactId="preparation"
              onDirtyChange={preparationChanged}
            />
          ) : activeView === "concept-lab" ? (
            <div
              className={`studio-body ${inspectorOpen ? "inspector-visible" : ""}`}
            >
              <ConceptLab
                toolbarTarget={conceptToolbarTarget}
                inspectorOpen={inspectorOpen}
                onClearExternal={() => setExternalConcepts([])}
                onInspectorClose={() => setInspectorVisibility(false)}
                terminalOpen={terminalOpen}
                onTerminalClose={() => setTerminalOpen(false)}
                onTerminalOpen={() => {
                  setTerminalOpen(true);
                  setInspectorOpen(true);
                }}
                {...(externalConcepts.length
                  ? { externalDrafts: externalConcepts }
                  : {})}
              />
            </div>
          ) : activeView === "mock-interview" ? (
            <MockInterview
              {...(externalMockControl
                ? { externalControl: externalMockControl }
                : {})}
            />
          ) : (
            <div
              className={`studio-body ${inspectorOpen ? "inspector-visible" : ""}`}
            >
              <section className="workspace">
                <div className="main-column">
                  <Card className="card question-card">
                    <div className="section-heading">
                      <div>
                        <span className="step">01</span>
                        <h2>Question</h2>
                      </div>
                      <span className="save-state">
                        {savedId ? "Saved" : "Workspace · unsaved"}
                      </span>
                    </div>
                    <div
                      className="question-tabs"
                      role="tablist"
                      aria-label="Question view"
                    >
                      <button
                        role="tab"
                        aria-selected={questionTab === "input"}
                        className={questionTab === "input" ? "active" : ""}
                        onClick={() => setQuestionTab("input")}
                      >
                        Question input
                      </button>
                      <button
                        role="tab"
                        aria-selected={questionTab === "preview"}
                        className={questionTab === "preview" ? "active" : ""}
                        onClick={() => setQuestionTab("preview")}
                      >
                        Rendered preview
                      </button>
                    </div>
                    {questionTab === "input" ? (
                      <div className="playground-question-entry">
                        <label className="playground-provider-field">
                          <span>Answer provider</span>
                          <select
                            aria-label="Answer provider"
                            value={answerProvider}
                            onChange={(event) =>
                              setAnswerProvider(
                                event.target.value as AnswerProvider,
                              )
                            }
                          >
                            <option value="">Choose a provider…</option>
                            {executionTargets.map((target) => (
                              <option key={target.id} value={target.id}>
                                {target.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <StudioTextarea
                          label="Interview question"
                          aria-label="Interview question"
                          rows={9}
                          value={question}
                          placeholder="Paste a coding, React, API, debugging, or system-design question…"
                          onChange={(nextQuestion) => {
                            localEdits.current = true;
                            setQuestion(nextQuestion);
                          }}
                        />
                        <Button
                          className="generate-button playground-generate-button"
                          onClick={() => void generate("new")}
                          disabled={busy || !question.trim() || !answerProvider}
                        >
                          {busy ? "Working…" : "Generate"}
                        </Button>
                        {answer ? (
                          <label className="playground-refinement-field">
                            <span>What should be fixed or expanded?</span>
                            <textarea
                              aria-label="Answer refinement"
                              rows={4}
                              value={refinementRequest}
                              placeholder="For example: Fix the stress-test expectation, support another constraint, or add missing edge-case tests…"
                              onChange={(event) =>
                                setRefinementRequest(event.target.value)
                              }
                            />
                            <Button
                              className="playground-refinement-button"
                              aria-label="Apply change"
                              onClick={() => void generate("refine")}
                              disabled={
                                busy ||
                                !question.trim() ||
                                !answerProvider ||
                                !refinementRequest.trim()
                              }
                            >
                              + Apply change
                            </Button>
                          </label>
                        ) : null}
                      </div>
                    ) : (
                      <article className="question-preview markdown">
                        {question.trim() ? (
                          <MarkdownContent>{question}</MarkdownContent>
                        ) : (
                          <span className="empty-preview">
                            Your rendered question will appear here.
                          </span>
                        )}
                      </article>
                    )}
                  </Card>

                  <Card className="card answer-card">
                    <div className="section-heading">
                      <div>
                        <span className="step">02</span>
                        <h2>{answer?.title ?? "Answer"}</h2>
                      </div>
                      {answer ? (
                        <Badge className="language-chip" variant="secondary">
                          {answer.language}
                        </Badge>
                      ) : null}
                    </div>

                    {answer ? (
                      <div className="answer-grid">
                        <article className="markdown">
                          <MarkdownContent>
                            {answer.answerMarkdown}
                          </MarkdownContent>
                        </article>
                        <div className="editor-shell">
                          <div
                            className="editor-tabs"
                            role="tablist"
                            aria-label="Code"
                          >
                            {editorTabs.map((tab) => (
                              <button
                                key={tab.id}
                                role="tab"
                                aria-selected={editorTab === tab.id}
                                className={editorTab === tab.id ? "active" : ""}
                                onClick={() => {
                                  syntaxRequestId.current += 1;
                                  setEditorTab(tab.id);
                                  setSyntaxState("idle");
                                  setSyntaxMessage("");
                                }}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>
                          <div className="editable-code-shell">
                            <CodeMirror
                              value={editorValue}
                              height="430px"
                              extensions={editorExtensions}
                              theme="dark"
                              onBlur={() => void checkSyntax(editorTab)}
                              aria-label={
                                editorTab === "solution"
                                  ? "Editable main solution"
                                  : editorTab === "usage"
                                    ? "Editable usage and output"
                                    : "Editable tests"
                              }
                              onChange={(source) => {
                                const normalizedSource =
                                  addsPhpEditorPrefix &&
                                  source.startsWith(PHP_EDITOR_PREFIX)
                                    ? source.slice(PHP_EDITOR_PREFIX.length)
                                    : source;
                                localEdits.current = true;
                                setSyntaxState("idle");
                                setSyntaxMessage("");
                                setAnswer({
                                  ...answer,
                                  ...(editorTab === "solution"
                                    ? { code: normalizedSource }
                                    : editorTab === "usage"
                                      ? { usageCode: normalizedSource }
                                      : { testCode: normalizedSource }),
                                });
                              }}
                            />
                            <IconButton
                              className="copy-code-button"
                              aria-label={
                                copiedCode ? "Code copied" : "Copy code"
                              }
                              title={copiedCode ? "Code copied" : "Copy code"}
                              onClick={() => void copyEditorCode()}
                              icon={
                                <svg
                                  aria-hidden="true"
                                  viewBox="0 0 24 24"
                                  width="16"
                                  height="16"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                >
                                  <rect
                                    x="8"
                                    y="8"
                                    width="12"
                                    height="12"
                                    rx="2"
                                  />
                                  <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                                </svg>
                              }
                            />
                          </div>
                          {syntaxState !== "idle" ? (
                            <div
                              className={`syntax-status syntax-${syntaxState}`}
                              aria-live="polite"
                            >
                              {syntaxState === "checking" ? (
                                <strong>Checking syntax…</strong>
                              ) : null}
                              {syntaxState === "valid" ? (
                                <strong>Syntax looks good</strong>
                              ) : null}
                              {syntaxState === "unavailable" ? (
                                <>
                                  <strong>Couldn’t check syntax</strong>
                                  {syntaxMessage ? (
                                    <span>{syntaxMessage}</span>
                                  ) : null}
                                </>
                              ) : null}
                              {syntaxState === "invalid" ? (
                                <>
                                  <pre
                                    className="syntax-raw"
                                    aria-label="Syntax checker output"
                                  >
                                    {syntaxMessage ||
                                      "Syntax checker reported an error."}
                                  </pre>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        {answer.language === "react" ? (
                          <section
                            className="react-preview-panel"
                            aria-label="React rendered preview"
                          >
                            <div className="react-preview-heading">
                              <h3>Rendered React preview</h3>
                              <span>
                                {previewState === "loading"
                                  ? "Compiling…"
                                  : previewState === "ready"
                                    ? "Live"
                                    : null}
                              </span>
                            </div>
                            {previewState === "error" ? (
                              <p className="react-preview-error">
                                {previewError}
                              </p>
                            ) : preview ? (
                              <iframe
                                title="Rendered React component"
                                className="react-preview-frame"
                                sandbox="allow-scripts"
                                srcDoc={`<!doctype html><html><body><div id="root"></div><script>${preview.replace(/<\/script/gi, "<\\/script")}</script></body></html>`}
                              />
                            ) : (
                              <p className="react-preview-empty">
                                The rendered component will appear here.
                              </p>
                            )}
                          </section>
                        ) : null}
                      </div>
                    ) : (
                      <div className="empty">
                        <strong>Your answer will appear here.</strong>
                        <CardDescription>
                          Generation creates a draft. Saving is always an
                          explicit action.
                        </CardDescription>
                      </div>
                    )}
                  </Card>
                </div>

                <StudioInspector
                  open={inspectorOpen}
                  onOpenChange={setInspectorVisibility}
                  description="Review notes, execution output, and saved answers."
                  preserveOnOutsideInteraction={terminalOpen}
                >
                  <>
                    <div className="card p-4 inspector-main">
                      <nav className="panel-tabs" aria-label="Inspector panels">
                        {panels.map((item) => (
                          <button
                            key={item.id}
                            className={panel === item.id ? "active" : ""}
                            onClick={() => {
                              setPanel(item.id);
                              setInspectorOpen(true);
                            }}
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
                          onChange={(value) => {
                            localEdits.current = true;
                            setNotes(value);
                          }}
                        />
                      ) : null}

                      {panel === "output" ? (
                        <div className="output">
                          <div className="output-toolbar">
                            <span className="output-label">Display</span>
                            <button
                              type="button"
                              className="output-wrap-toggle"
                              aria-pressed={wordWrap}
                              aria-label="Toggle word wrap"
                              onClick={toggleWordWrap}
                            >
                              Word wrap: {wordWrap ? "On" : "Off"}
                            </button>
                          </div>
                          <div
                            className="output-tabs"
                            role="tablist"
                            aria-label="Run output"
                          >
                            <button
                              role="tab"
                              aria-selected={outputTab === "solution"}
                              className={
                                outputTab === "solution" ? "active" : ""
                              }
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
                                  outputTab === "tests"
                                    ? output.tests
                                    : output.solution;
                                if (!result) return null;
                                const failed =
                                  result.exitCode !== 0 || result.timedOut;
                                return (
                                  <>
                                    <div
                                      className={`run-meta ${failed ? "run-failed" : "run-passed"}`}
                                    >
                                      <span>
                                        {failed ? "Failed" : "Passed"} · exit{" "}
                                        {String(result.exitCode)} ·{" "}
                                        {result.durationMs}
                                        ms
                                      </span>
                                      <button
                                        type="button"
                                        className="copy-output"
                                        aria-label={`Copy ${outputTab === "tests" ? "test results" : "normal output"}`}
                                        title={`Copy ${outputTab === "tests" ? "test results" : "normal output"}`}
                                        onClick={() =>
                                          void copyOutput(outputTab, result)
                                        }
                                      >
                                        {copiedOutput === outputTab ? "✓" : "⧉"}
                                      </button>
                                    </div>
                                    <pre
                                      className={`${failed ? "output-error" : "output-success"} ${wordWrap ? "output-wrap" : "output-nowrap"}`}
                                    >
                                      {result.stdout ||
                                        result.stderr ||
                                        "(no output)"}
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
                            <div className="empty compact">
                              No saved answers yet.
                            </div>
                          ) : (
                            <>
                              {visibleSavedAnswers.map((saved) => (
                                <div className="saved-item" key={saved.id}>
                                  <button
                                    type="button"
                                    className="saved-open-button"
                                    onClick={() => openSaved(saved)}
                                  >
                                    <strong>{saved.title}</strong>
                                    <span>
                                      {saved.language} ·{" "}
                                      {formatTimestamp(saved.updatedAt)}
                                    </span>
                                  </button>
                                  <IconButton
                                    className="saved-delete-button"
                                    aria-label="Delete saved answer"
                                    onClick={() => void deleteSaved(saved.id)}
                                    disabled={busy}
                                    icon={
                                      <svg
                                        aria-hidden="true"
                                        viewBox="0 0 24 24"
                                        width="16"
                                        height="16"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                      >
                                        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7l1-3h4l1 3" />
                                      </svg>
                                    }
                                  />
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
                                      setSavedPage((page) =>
                                        Math.max(0, page - 1),
                                      )
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
                    </div>
                    <TerminalDock
                      open={terminalOpen}
                      onClose={() => setTerminalOpen(false)}
                      sessionName={playgroundTerminalSession}
                    />
                  </>
                </StudioInspector>
                <p className="status workspace-status" role="status">
                  {status}
                </p>
              </section>
            </div>
          )}
        </main>
      </App>
    </ConfigProvider>
  );
  return page;
}
