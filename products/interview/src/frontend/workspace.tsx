"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";
import { AssistantPanel } from "@omnitech-assistant/react";
import type { AssistantClient } from "@omnitech-assistant/sdk";
import type { Origin } from "@omnitech-assistant/contracts";
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
import { MarkdownContent } from "./markdown-content";
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

interface ExampleTemplate {
  id: string;
  label: string;
  language: Language;
  question: string;
  answer: GeneratedAnswer;
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

const exampleTemplates: ExampleTemplate[] = [
  {
    id: "php-log-window",
    label: "PHP · Aggregate log events by sliding window",
    language: "php",
    question:
      "# Maximum Events in a Time Window\n\nGiven a sorted integer array `timestamps` and an integer `window`, return the maximum number of events whose timestamps fit inside any inclusive interval of length `window`.\n\n## Examples\n\n- `timestamps = [1, 2, 3, 8, 9], window = 2` → `3`\n- `timestamps = [4, 4, 5, 10], window = 0` → `2`\n\n## Constraints\n\n- `1 <= timestamps.length <= 100000`\n- `0 <= timestamps[i] <= 10^9`\n- `0 <= window <= 10^9`\n- `timestamps` is sorted in non-decreasing order.\n\n## Follow-up\n\nExplain the two-pointer invariant and provide Pest tests for duplicates, boundary timestamps, and a single event.",
    answer: {
      title: "Maximum Events in a Time Window",
      language: "php",
      answerMarkdown:
        "## Approach\n\n- Maintain a **left pointer** and expand the right pointer across the sorted timestamps.\n- Move `left` forward while the inclusive window exceeds `window`.\n- Track the largest valid window size.\n\n## Complexity\n\n- **Time:** `O(n)`\n- **Space:** `O(1)`\n\n## Talking points\n\n- Sorting is already guaranteed, so each pointer moves only forward.\n- Duplicate timestamps naturally remain in the same window.\n- The boundary is inclusive: `timestamps[right] - timestamps[left] <= window`.",
      code: "<?php\n\nfunction solution(array $timestamps, int $window): int\n{\n    $left = 0;\n    $best = 0;\n\n    foreach ($timestamps as $right => $timestamp) {\n        while ($timestamp - $timestamps[$left] > $window) {\n            $left++;\n        }\n\n        $best = max($best, $right - $left + 1);\n    }\n\n    return $best;\n}\n",
      usageCode:
        "echo solution([1, 2, 3, 8, 9], 2), PHP_EOL;\necho solution([4, 4, 5, 10], 0), PHP_EOL;",
      testCode:
        "it('counts events on the inclusive boundary', function () {\n    expect(solution([1, 2, 3, 8, 9], 2))->toBe(3);\n});\n\nit('keeps duplicate timestamps together', function () {\n    expect(solution([4, 4, 5, 10], 0))->toBe(2);\n});\n\nit('handles one event', function () {\n    expect(solution([42], 0))->toBe(1);\n});",
    },
  },
  {
    id: "react-search-panel",
    label: "React · Debounced accessible search panel",
    language: "react",
    question:
      "# Accessible Debounced Search\n\nBuild a React component `SearchBox` that accepts an async `search(query)` prop and renders a labelled search input plus a result list. Debounce requests by 300ms, ignore stale responses, expose loading and error states, and allow keyboard users to reach every result.\n\n## Examples\n\n- Typing `ca` then `cat` should only display the latest `cat` results.\n- A rejected request should show an actionable error message.\n\n## Constraints\n\n- Do not mutate the results array.\n- Do not update state after an obsolete request resolves.\n- The input must have an accessible label and results must use list semantics.\n\n## Follow-up\n\nExplain the cancellation/staleness invariant and provide Vitest + React Testing Library tests for success, stale responses, loading, errors, and keyboard access.",
    answer: {
      title: "Accessible Debounced Search",
      language: "react",
      answerMarkdown:
        "## Approach\n\n- Keep the query, results, loading, and error state together.\n- Debounce the request effect and cancel its timer during cleanup.\n- Use a request id so an older response cannot overwrite newer results.\n- Render semantic `ul`/`li` results with keyboard-focusable links.\n\n## Complexity\n\n- **Time:** `O(r)` to render `r` results.\n- **Space:** `O(r)` for the current result list.\n\n## Talking points\n\n- Cleanup prevents unnecessary requests.\n- The request id protects against out-of-order responses.\n- Labels and list semantics make the component usable with assistive technology.",
      code: 'import { useEffect, useRef, useState } from \'react\';\n\ntype SearchBoxProps = {\n  search: (query: string) => Promise<string[]>;\n};\n\nexport function SearchBox({ search }: SearchBoxProps) {\n  const [query, setQuery] = useState(\'\');\n  const [results, setResults] = useState<string[]>([]);\n  const [loading, setLoading] = useState(false);\n  const [error, setError] = useState(\'\');\n  const requestId = useRef(0);\n\n  useEffect(() => {\n    if (!query.trim()) {\n      setResults([]);\n      setLoading(false);\n      return;\n    }\n\n    const id = ++requestId.current;\n    const timer = window.setTimeout(async () => {\n      setLoading(true);\n      setError(\'\');\n      try {\n        const nextResults = await search(query);\n        if (id === requestId.current) setResults(nextResults);\n      } catch {\n        if (id === requestId.current) setError(\'Search failed. Try again.\');\n      } finally {\n        if (id === requestId.current) setLoading(false);\n      }\n    }, 300);\n\n    return () => window.clearTimeout(timer);\n  }, [query, search]);\n\n  return (\n    <section aria-labelledby="search-heading">\n      <h2 id="search-heading">Search</h2>\n      <label htmlFor="search-input">Search results</label>\n      <input id="search-input" value={query} onChange={(event) => setQuery(event.target.value)} />\n      {loading && <p role="status">Loading…</p>}\n      {error && <p role="alert">{error}</p>}\n      <ul aria-label="Search results">\n        {results.map((result) => <li key={result}><a href={`/items/${result}`}>{result}</a></li>)}\n      </ul>\n    </section>\n  );\n}',
      usageCode:
        "<SearchBox search={async (query) => [`${query}-one`, `${query}-two`]} />",
      testCode:
        "import { cleanup, render, screen } from '@testing-library/react';\nimport userEvent from '@testing-library/user-event';\nimport { afterEach, describe, expect, it, vi } from 'vitest';\nimport { SearchBox } from './SearchBox';\n\nafterEach(cleanup);\n\ndescribe('SearchBox', () => {\n  it('renders results and exposes them as links', async () => {\n    const search = vi.fn().mockResolvedValue(['cat']);\n    render(<SearchBox search={search} />);\n    await userEvent.type(screen.getByLabelText('Search query'), 'cat');\n    const result = await screen.findByRole('link', { name: 'cat' });\n    expect(result.getAttribute('href')).toBe('/items/cat');\n  });\n\n  it('reports rejected searches', async () => {\n    const search = vi.fn().mockRejectedValue(new Error('offline'));\n    render(<SearchBox search={search} />);\n    await userEvent.type(screen.getByLabelText('Search query'), 'cat');\n    const error = await screen.findByRole('alert');\n    expect(error.textContent).toContain('Search failed');\n  });\n});",
    },
  },
  {
    id: "typescript-dependency-order",
    label: "TypeScript · Dependency-aware task ordering",
    language: "typescript",
    question:
      "# Dependency Order\n\nGiven task names and directed dependency pairs `[task, dependency]`, return a deterministic order in which every dependency appears before its task. If a cycle exists, return the names that cannot be scheduled.\n\n## Examples\n\n- `tasks = ['build', 'test', 'deploy']`, `dependencies = [['test', 'build'], ['deploy', 'test']]` → `['build', 'test', 'deploy']`\n- A cycle `a -> b -> a` returns `['a', 'b']` as unscheduled tasks.\n\n## Constraints\n\n- `1 <= tasks.length <= 100000`\n- Task names are unique strings.\n- Duplicate dependency pairs may appear.\n- The result must be deterministic.\n\n## Follow-up\n\nUse Kahn's algorithm with an adjacency map and include Vitest tests for branching, disconnected tasks, duplicate edges, and cycles.",
    answer: {
      title: "Deterministic Dependency Order",
      language: "typescript",
      answerMarkdown:
        "## Approach\n\n- Build an adjacency map and indegree count for every task.\n- Seed a sorted queue with tasks whose indegree is zero.\n- Remove the smallest available task, then unlock its dependants.\n- Any task not emitted belongs to a dependency cycle.\n\n## Complexity\n\n- **Time:** `O((V + E) log V)` because the ready queue stays deterministic.\n- **Space:** `O(V + E)`.\n\n## Talking points\n\n- Indegree captures exactly how many prerequisites remain.\n- Sorting the ready queue makes equal-valid answers predictable.\n- Unemitted nodes are the cycle remainder, not arbitrary failures.",
      code: "export type Dependency = readonly [task: string, dependency: string];\nexport type OrderResult = { order: string[]; cycle: string[] };\n\nexport function solution(tasks: string[], dependencies: readonly Dependency[]): OrderResult {\n  const edges = new Map<string, Set<string>>();\n  const indegree = new Map(tasks.map((task) => [task, 0]));\n\n  for (const [task, dependency] of dependencies) {\n    const dependants = edges.get(dependency) ?? new Set<string>();\n    if (!dependants.has(task)) {\n      dependants.add(task);\n      edges.set(dependency, dependants);\n      indegree.set(task, (indegree.get(task) ?? 0) + 1);\n    }\n  }\n\n  const ready = tasks.filter((task) => indegree.get(task) === 0).sort();\n  const order: string[] = [];\n  while (ready.length > 0) {\n    const current = ready.shift() as string;\n    order.push(current);\n    for (const dependant of edges.get(current) ?? []) {\n      const next = (indegree.get(dependant) ?? 0) - 1;\n      indegree.set(dependant, next);\n      if (next === 0) insertSorted(ready, dependant);\n    }\n  }\n\n  return { order, cycle: tasks.filter((task) => !order.includes(task)).sort() };\n}\n\nfunction insertSorted(values: string[], value: string): void {\n  const index = values.findIndex((candidate) => candidate > value);\n  values.splice(index === -1 ? values.length : index, 0, value);\n}",
      usageCode:
        "console.log(solution(['build', 'test', 'deploy'], [['test', 'build'], ['deploy', 'test']]));",
      testCode:
        "import { describe, expect, it } from 'vitest';\nimport { solution } from './solution';\n\ndescribe('solution', () => {\n  it('orders branching dependencies deterministically', () => {\n    expect(solution(['deploy', 'test', 'build'], [['deploy', 'test'], ['test', 'build']])).toEqual({ order: ['build', 'test', 'deploy'], cycle: [] });\n  });\n\n  it('reports cycle members', () => {\n    expect(solution(['a', 'b'], [['a', 'b'], ['b', 'a']]).cycle).toEqual(['a', 'b']);\n  });\n});",
    },
  },
  {
    id: "ruby-rate-limiter",
    label: "Ruby · Sliding-window rate limiter",
    language: "ruby",
    question:
      "# Sliding-Window Rate Limiter\n\nGiven sorted request timestamps, a maximum number of requests `limit`, and an inclusive window size `window`, return a Boolean array indicating which requests are allowed. A request is allowed when fewer than `limit` previously allowed requests are inside its window.\n\n## Examples\n\n- `timestamps = [0, 1, 2, 10], limit = 2, window = 2` → `[true, true, false, true]`\n- `timestamps = [], limit = 3, window = 10` → `[]`\n\n## Constraints\n\n- `0 <= timestamps.length <= 100000`\n- `1 <= limit <= 100000`\n- `0 <= timestamps[i] <= 10^9`\n- Timestamps are sorted in non-decreasing order.\n\n## Follow-up\n\nExplain why rejected requests do not consume capacity and include RSpec tests for bursts, exact boundaries, and empty input.",
    answer: {
      title: "Sliding-Window Rate Limiter",
      language: "ruby",
      answerMarkdown:
        "## Approach\n\n- Keep a queue of timestamps for allowed requests only.\n- Remove allowed timestamps older than the inclusive window.\n- Allow the current request when the queue has capacity; otherwise reject it.\n\n## Complexity\n\n- **Time:** `O(n)` amortized because each timestamp is added and removed once.\n- **Space:** `O(limit)` for the active window.\n\n## Talking points\n\n- Rejected requests do not enter the queue, so they do not consume capacity.\n- The comparison is inclusive: timestamps at `current - window` remain valid.\n- A queue models the active window without rescanning old requests.",
      code: "def solution(timestamps, limit, window)\n  allowed_timestamps = []\n\n  timestamps.map do |timestamp|\n    allowed_timestamps.shift while allowed_timestamps.any? && timestamp - allowed_timestamps.first > window\n\n    if allowed_timestamps.length < limit\n      allowed_timestamps << timestamp\n      true\n    else\n      false\n    end\n  end\nend",
      usageCode: "p solution([0, 1, 2, 10], 2, 2)\np solution([], 3, 10)",
      testCode:
        "require 'rspec/autorun'\n\nRSpec.describe '#solution' do\n  it 'rejects only requests beyond the burst capacity' do\n    expect(solution([0, 1, 2, 10], 2, 2)).to eq([true, true, false, true])\n  end\n\n  it 'keeps an exact boundary timestamp in the window' do\n    expect(solution([0, 2], 1, 2)).to eq([true, false])\n  end\n\n  it 'handles empty input' do\n    expect(solution([], 3, 10)).to eq([])\n  end\nend",
    },
  },
];

const preparedExampleTemplates = exampleTemplates.map((template) => {
  if (template.id !== "react-search-panel") return template;
  return {
    ...template,
    answer: {
      ...template.answer,
      code: template.answer.code.replace(
        '<label htmlFor="search-input">Search results</label>',
        '<label htmlFor="search-input">Search query</label>',
      ),
      testCode: template.answer.testCode.replaceAll(
        "getByLabelText('Search results')",
        "getByLabelText('Search query')",
      ),
    },
  };
});

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

export interface WorkspaceAssistant {
  client: AssistantClient;
  profileId: string;
  workspaceId: string;
  artifactId: string;
}
interface CanonicalDraft {
  origin: Origin;
  value: { question: string; notes: string; answer: GeneratedAnswer | null };
}
export function Workspace({
  assistant,
}: { assistant?: WorkspaceAssistant } & Partial<ProductPageProps> = {}) {
  const [activeView, setActiveView] = useState<
    "playground" | "concept-lab" | "mock-interview"
  >("playground");
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
  const [assistantOrigin, setAssistantOrigin] = useState<Origin>();
  const originRef = useRef<Origin | undefined>(undefined);
  const canonicalValue = useRef<string>("");
  const workingValue = useRef({ question, notes, answer: answer ?? null });
  workingValue.current = { question, notes, answer: answer ?? null };
  const workspacePath = assistant
    ? `/api/interview/workspaces/${encodeURIComponent(assistant.workspaceId)}/artifacts/${encodeURIComponent(assistant.artifactId)}`
    : "";
  const flushPending = useRef<Promise<Origin> | null>(null);
  const effectKeys = useRef<
    Record<string, { fingerprint: string; id: string }>
  >({});
  function effectKey(kind: string, origin: Origin) {
    const fingerprint = JSON.stringify(origin);
    const prior = effectKeys.current[kind];
    if (prior?.fingerprint === fingerprint) return prior.id;
    const id = crypto.randomUUID();
    effectKeys.current[kind] = { fingerprint, id };
    return id;
  }
  async function workspaceRequest<T>(
    suffix: string,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetch(workspacePath + suffix, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.code ?? "workspace-request-failed");
    return body as T;
  }
  function hydrateCanonical(record: CanonicalDraft) {
    originRef.current = record.origin;
    setAssistantOrigin(record.origin);
    canonicalValue.current = JSON.stringify(record.value);
    workingValue.current = record.value;
    setQuestion(record.value.question);
    setNotes(record.value.notes);
    setAnswer(normalizeAnswer(record.value.answer ?? undefined));
  }
  async function flushDraft(): Promise<Origin> {
    if (flushPending.current) return flushPending.current;
    if (!originRef.current) throw new Error("workspace-not-ready");
    const captured = { ...workingValue.current },
      expected = originRef.current;
    if (JSON.stringify(captured) === canonicalValue.current) return expected;
    const operation = (async () => {
      const record = await workspaceRequest<CanonicalDraft>("", {
        method: "PATCH",
        body: JSON.stringify({ origin: expected, patch: captured }),
      });
      originRef.current = record.origin;
      setAssistantOrigin(record.origin);
      canonicalValue.current = JSON.stringify(record.value);
      if (JSON.stringify(workingValue.current) !== JSON.stringify(captured))
        throw new Error(
          "New local edits arrived; submit them before continuing.",
        );
      return record.origin;
    })();
    flushPending.current = operation;
    try {
      return await operation;
    } finally {
      flushPending.current = null;
    }
  }
  useEffect(() => {
    if (!assistant) return;
    let active = true;
    void workspaceRequest<CanonicalDraft>("")
      .then((record) => {
        if (active) hydrateCanonical(record);
      })
      .catch((error) => {
        if (active)
          setStatus(
            error instanceof Error ? error.message : "workspace-load-failed",
          );
      });
    return () => {
      active = false;
    };
  }, [workspacePath]);
  const localEdits = useRef(false);
  const draftHydrated = useRef(false);
  const syntaxRequestId = useRef(0);
  const previewRequestId = useRef(0);
  const appliedControlRevision = useRef(-1);

  useEffect(() => {
    const requestedView = new URLSearchParams(window.location.search).get(
      "view",
    );
    if (requestedView === "concept-lab" || requestedView === "mock-interview")
      setActiveView(requestedView);
  }, []);

  function selectWorkspace(
    view: "playground" | "concept-lab" | "mock-interview",
  ) {
    setActiveView(view);
    window.history.replaceState(
      {},
      "",
      view === "playground" ? "/" : `/?view=${view}`,
    );
  }

  const loadSaved = useCallback(async () => {
    setSavedAnswers(
      await api<SavedAnswer[]>(
        assistant
          ? `/answers?artifact=${encodeURIComponent(assistant.artifactId)}`
          : "/answers",
      ),
    );
    setSavedPage(0);
  }, [assistant?.artifactId]);

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
    if (assistant || answer?.language !== "react" || !answer.code.trim()) {
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
    if (assistant) return;
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
    if (assistant || !draftHydrated.current) return;
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
    if (assistant) return;
    let active = true;

    async function applyExternalControl() {
      try {
        const snapshot = await api<PlaygroundSnapshot>("/playground-control", {
          cache: "no-store",
        });
        if (
          !active ||
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
    providerId: "openai" | "lm-studio",
  ): Promise<GeneratedAnswer> {
    const generated = await api<GeneratedAnswer>("/generate", {
      method: "POST",
      body: JSON.stringify({
        question: questionValue,
        language: languageValue,
        providerId,
      }),
    });
    return normalizeAnswer(generated) as GeneratedAnswer;
  }

  async function generate(mode: "new" | "refine" = "new") {
    if (assistant) {
      setStatus("Use the interview assistant to generate a reviewed proposal.");
      return;
    }
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
      if (assistant) {
        const origin = await flushDraft();
        await workspaceRequest("/save", {
          method: "POST",
          body: JSON.stringify({
            origin,
            requestId: effectKey("save", origin),
          }),
        });
        delete effectKeys.current["save"];
        await loadSaved();
        setStatus("Saved immutable answer version.");
        return;
      }
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
    if (assistant) {
      setBusy(true);
      setInspectorOpen(true);
      setPanel("output");
      setOutputTab("tests");
      try {
        const origin = await flushDraft();
        const result = await workspaceRequest<{ execution: RunResult }>(
          "/run-code",
          {
            method: "POST",
            body: JSON.stringify({
              origin,
              requestId: effectKey("run-code", origin),
            }),
          },
        );
        delete effectKeys.current["run-code"];
        setOutput({ tests: result.execution });
        setStatus(
          result.execution.exitCode === 0 && !result.execution.timedOut
            ? "Tests passed"
            : "Tests failed",
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "code-run-failed");
      } finally {
        setBusy(false);
      }
      return;
    }
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
    if (assistant) {
      setStatus("Choose a new question using the question selector.");
      return;
    }
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
    if (assistant) {
      setSyntaxState("unavailable");
      setSyntaxMessage("Run tests explicitly to validate the canonical draft.");
      return;
    }
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

  return (
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
                {activeView === "concept-lab" ? "Briefing" : "Rehearsal"}
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
                  {assistant ? "Save answer" : "Save"}
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
                  {assistant ? "Run tests" : "Run All"}
                </Button>
                <span className="toolbar-divider" aria-hidden="true" />
                {!assistant && (
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
                )}
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
                {!assistant && (
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
                )}
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

          {assistant && assistantOrigin && (
            <section className="assistant-workspace-dock">
              <button
                type="button"
                onClick={() =>
                  void workspaceRequest<CanonicalDraft>("")
                    .then(hydrateCanonical)
                    .catch((error) => setStatus(error.message))
                }
              >
                Reload canonical draft
              </button>
              <AssistantPanel
                client={assistant.client}
                origin={assistantOrigin}
                profileId={assistant.profileId}
                prepareSend={flushDraft}
                beforeApply={async () => {
                  await flushDraft();
                }}
                slots={{
                  message: (text, role) =>
                    role === "assistant" ? (
                      <MarkdownContent>{text}</MarkdownContent>
                    ) : (
                      <p style={{ whiteSpace: "pre-wrap" }}>{text}</p>
                    ),
                  proposal: (record) => (
                    <div>
                      <p>
                        {String(
                          (
                            record.proposal.patch["answer"] as Record<
                              string,
                              unknown
                            >
                          )?.["title"] ?? "Proposed answer",
                        )}
                      </p>
                      <pre>
                        {JSON.stringify(record.proposal.patch, null, 2)}
                      </pre>
                    </div>
                  ),
                }}
                onApplied={async (_receipt, captured) => {
                  const snapshot = JSON.stringify(workingValue.current),
                    record = await workspaceRequest<CanonicalDraft>("");
                  if (
                    originRef.current?.workspaceId !== captured.workspaceId ||
                    originRef.current?.artifactId !== captured.artifactId ||
                    JSON.stringify(workingValue.current) !== snapshot
                  ) {
                    setStatus(
                      "Proposal accepted; local edits preserved. Reload canonical draft explicitly to review.",
                    );
                    return;
                  }
                  hydrateCanonical(record);
                  setStatus("Reviewed proposal applied to draft. Not saved.");
                }}
              />
            </section>
          )}
          {navigationOpen ? (
            <StudioNavigation
              active={activeView}
              onSelect={selectWorkspace}
              onClose={() => setNavigationOpen(false)}
            />
          ) : null}

          {activeView === "concept-lab" ? (
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
                        {!assistant && (
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
                        )}
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
                        {!assistant && (
                          <Button
                            className="generate-button playground-generate-button"
                            onClick={() => void generate("new")}
                            disabled={
                              busy || !question.trim() || !answerProvider
                            }
                          >
                            {busy ? "Working…" : "Generate"}
                          </Button>
                        )}
                        {answer && !assistant ? (
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
                    {!assistant && (
                      <TerminalDock
                        open={terminalOpen}
                        onClose={() => setTerminalOpen(false)}
                        sessionName={playgroundTerminalSession}
                      />
                    )}
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
}
