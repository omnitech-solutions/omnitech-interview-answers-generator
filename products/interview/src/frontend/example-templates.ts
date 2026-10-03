import {
  type AnswerGuide,
  type GeneratedAnswer,
  type Language,
  renderGuideMarkdown,
} from "@omnitech/interview-contracts";

// Worked examples a person can start from instead of typing a question.
export interface ExampleTemplate {
  id: string;
  label: string;
  language: Language;
  question: string;
  answer: GeneratedAnswer;
}

// The answer's Markdown is its guide's rendering, as for every answer.
const guided = (
  answer: Omit<GeneratedAnswer, "answerMarkdown" | "guide">,
  guide: AnswerGuide,
): GeneratedAnswer => ({
  ...answer,
  answerMarkdown: renderGuideMarkdown(guide),
  guide,
});

const draftTemplates: ExampleTemplate[] = [
  {
    id: "php-log-window",
    label: "PHP · Aggregate log events by sliding window",
    language: "php",
    question:
      "# Maximum Events in a Time Window\n\nGiven a sorted integer array `timestamps` and an integer `window`, return the maximum number of events whose timestamps fit inside any inclusive interval of length `window`.\n\n## Examples\n\n- `timestamps = [1, 2, 3, 8, 9], window = 2` → `3`\n- `timestamps = [4, 4, 5, 10], window = 0` → `2`\n\n## Constraints\n\n- `1 <= timestamps.length <= 100000`\n- `0 <= timestamps[i] <= 10^9`\n- `0 <= window <= 10^9`\n- `timestamps` is sorted in non-decreasing order.\n\n## Follow-up\n\nExplain the two-pointer invariant and provide Pest tests for duplicates, boundary timestamps, and a single event.",
    answer: guided(
      {
        title: "Maximum Events in a Time Window",
        language: "php",
        code: "<?php\n\nfunction solution(array $timestamps, int $window): int\n{\n    $left = 0;\n    $best = 0;\n\n    foreach ($timestamps as $right => $timestamp) {\n        while ($timestamp - $timestamps[$left] > $window) {\n            $left++;\n        }\n\n        $best = max($best, $right - $left + 1);\n    }\n\n    return $best;\n}\n",
        usageCode:
          "echo solution([1, 2, 3, 8, 9], 2), PHP_EOL;\necho solution([4, 4, 5, 10], 0), PHP_EOL;",
        testCode:
          "it('counts events on the inclusive boundary', function () {\n    expect(solution([1, 2, 3, 8, 9], 2))->toBe(3);\n});\n\nit('keeps duplicate timestamps together', function () {\n    expect(solution([4, 4, 5, 10], 0))->toBe(2);\n});\n\nit('handles one event', function () {\n    expect(solution([42], 0))->toBe(1);\n});",
      },
      {
        version: 1,
        understand: {
          prompt:
            "Return the most events whose sorted timestamps fit inside any **inclusive** interval of length `window`.",
          examples: [
            { input: "timestamps = [1, 2, 3, 8, 9], window = 2", output: "3" },
            { input: "timestamps = [4, 4, 5, 10], window = 0", output: "2" },
          ],
          constraints: [
            "1 <= timestamps.length <= 100000",
            "0 <= timestamps[i], window <= 10^9",
            "timestamps is sorted in non-decreasing order",
          ],
          clarify: ["Is the window boundary inclusive at both ends?"],
        },
        plan: {
          steps: [
            "Maintain a **left pointer** and expand the right pointer across the sorted timestamps.",
            "Move `left` forward while the inclusive window exceeds `window`.",
            "Track the largest valid window size.",
          ],
          complexity: { time: "O(n)", space: "O(1)" },
        },
        edgeCases: [
          {
            name: "Event on the inclusive boundary",
            test: "counts events on the inclusive boundary",
          },
          {
            name: "Duplicate timestamps",
            test: "keeps duplicate timestamps together",
          },
          { name: "A single event", test: "handles one event" },
        ],
        explain: [
          {
            heading: "The two-pointer invariant",
            body: "Every timestamp between `left` and `right` fits in the window, and both pointers only move forward.",
          },
        ],
        talkingPoints: [
          "Sorting is already guaranteed, so each pointer moves only forward.",
          "Duplicate timestamps naturally remain in the same window.",
          "The boundary is inclusive: `timestamps[right] - timestamps[left] <= window`.",
        ],
      },
    ),
  },
  {
    id: "react-search-panel",
    label: "React · Debounced accessible search panel",
    language: "react",
    question:
      "# Accessible Debounced Search\n\nBuild a React component `SearchBox` that accepts an async `search(query)` prop and renders a labelled search input plus a result list. Debounce requests by 300ms, ignore stale responses, expose loading and error states, and allow keyboard users to reach every result.\n\n## Examples\n\n- Typing `ca` then `cat` should only display the latest `cat` results.\n- A rejected request should show an actionable error message.\n\n## Constraints\n\n- Do not mutate the results array.\n- Do not update state after an obsolete request resolves.\n- The input must have an accessible label and results must use list semantics.\n\n## Follow-up\n\nExplain the cancellation/staleness invariant and provide Vitest + React Testing Library tests for success, stale responses, loading, errors, and keyboard access.",
    answer: guided(
      {
        title: "Accessible Debounced Search",
        language: "react",
        code: 'import { useEffect, useRef, useState } from \'react\';\n\ntype SearchBoxProps = {\n  search: (query: string) => Promise<string[]>;\n};\n\nexport function SearchBox({ search }: SearchBoxProps) {\n  const [query, setQuery] = useState(\'\');\n  const [results, setResults] = useState<string[]>([]);\n  const [loading, setLoading] = useState(false);\n  const [error, setError] = useState(\'\');\n  const requestId = useRef(0);\n\n  useEffect(() => {\n    if (!query.trim()) {\n      setResults([]);\n      setLoading(false);\n      return;\n    }\n\n    const id = ++requestId.current;\n    const timer = window.setTimeout(async () => {\n      setLoading(true);\n      setError(\'\');\n      try {\n        const nextResults = await search(query);\n        if (id === requestId.current) setResults(nextResults);\n      } catch {\n        if (id === requestId.current) setError(\'Search failed. Try again.\');\n      } finally {\n        if (id === requestId.current) setLoading(false);\n      }\n    }, 300);\n\n    return () => window.clearTimeout(timer);\n  }, [query, search]);\n\n  return (\n    <section aria-labelledby="search-heading">\n      <h2 id="search-heading">Search</h2>\n      <label htmlFor="search-input">Search results</label>\n      <input id="search-input" value={query} onChange={(event) => setQuery(event.target.value)} />\n      {loading && <p role="status">Loading…</p>}\n      {error && <p role="alert">{error}</p>}\n      <ul aria-label="Search results">\n        {results.map((result) => <li key={result}><a href={`/items/${result}`}>{result}</a></li>)}\n      </ul>\n    </section>\n  );\n}',
        usageCode:
          "<SearchBox search={async (query) => [`${query}-one`, `${query}-two`]} />",
        testCode:
          "import { cleanup, render, screen } from '@testing-library/react';\nimport userEvent from '@testing-library/user-event';\nimport { afterEach, describe, expect, it, vi } from 'vitest';\nimport { SearchBox } from './SearchBox';\n\nafterEach(cleanup);\n\ndescribe('SearchBox', () => {\n  it('renders results and exposes them as links', async () => {\n    const search = vi.fn().mockResolvedValue(['cat']);\n    render(<SearchBox search={search} />);\n    await userEvent.type(screen.getByLabelText('Search query'), 'cat');\n    const result = await screen.findByRole('link', { name: 'cat' });\n    expect(result.getAttribute('href')).toBe('/items/cat');\n  });\n\n  it('reports rejected searches', async () => {\n    const search = vi.fn().mockRejectedValue(new Error('offline'));\n    render(<SearchBox search={search} />);\n    await userEvent.type(screen.getByLabelText('Search query'), 'cat');\n    const error = await screen.findByRole('alert');\n    expect(error.textContent).toContain('Search failed');\n  });\n});",
      },
      {
        version: 1,
        understand: {
          prompt:
            "Build `SearchBox`: a labelled search input and result list that **debounces** requests by 300ms and ignores **stale responses**.",
          examples: [
            {
              input: "type `ca`, then `cat`",
              output: "only the `cat` results",
            },
            { input: "a rejected request", output: "an actionable error" },
          ],
          constraints: [
            "Do not mutate the results array.",
            "Do not update state after an obsolete request resolves.",
            "Label the input and use list semantics for results.",
          ],
          clarify: ["Should an empty query clear the results?"],
        },
        plan: {
          steps: [
            "Keep the query, results, loading, and error state together.",
            "Debounce the request effect and cancel its timer during cleanup.",
            "Use a request id so an older response cannot overwrite newer results.",
            "Render semantic `ul`/`li` results with keyboard-focusable links.",
          ],
          complexity: {
            time: "O(r)",
            space: "O(r)",
            note: "for `r` rendered results",
          },
        },
        edgeCases: [
          {
            name: "Results reachable as links",
            test: "renders results and exposes them as links",
          },
          { name: "Rejected search", test: "reports rejected searches" },
        ],
        explain: [
          {
            heading: "Staleness",
            body: "A request id records the latest search; a response for an older id is dropped.",
          },
        ],
        talkingPoints: [
          "Cleanup prevents unnecessary requests.",
          "The request id protects against out-of-order responses.",
          "Labels and list semantics make the component usable with assistive technology.",
        ],
      },
    ),
  },
  {
    id: "typescript-dependency-order",
    label: "TypeScript · Dependency-aware task ordering",
    language: "typescript",
    question:
      "# Dependency Order\n\nGiven task names and directed dependency pairs `[task, dependency]`, return a deterministic order in which every dependency appears before its task. If a cycle exists, return the names that cannot be scheduled.\n\n## Examples\n\n- `tasks = ['build', 'test', 'deploy']`, `dependencies = [['test', 'build'], ['deploy', 'test']]` → `['build', 'test', 'deploy']`\n- A cycle `a -> b -> a` returns `['a', 'b']` as unscheduled tasks.\n\n## Constraints\n\n- `1 <= tasks.length <= 100000`\n- Task names are unique strings.\n- Duplicate dependency pairs may appear.\n- The result must be deterministic.\n\n## Follow-up\n\nUse Kahn's algorithm with an adjacency map and include Vitest tests for branching, disconnected tasks, duplicate edges, and cycles.",
    answer: guided(
      {
        title: "Deterministic Dependency Order",
        language: "typescript",
        code: "export type Dependency = readonly [task: string, dependency: string];\nexport type OrderResult = { order: string[]; cycle: string[] };\n\nexport function solution(tasks: string[], dependencies: readonly Dependency[]): OrderResult {\n  const edges = new Map<string, Set<string>>();\n  const indegree = new Map(tasks.map((task) => [task, 0]));\n\n  for (const [task, dependency] of dependencies) {\n    const dependants = edges.get(dependency) ?? new Set<string>();\n    if (!dependants.has(task)) {\n      dependants.add(task);\n      edges.set(dependency, dependants);\n      indegree.set(task, (indegree.get(task) ?? 0) + 1);\n    }\n  }\n\n  const ready = tasks.filter((task) => indegree.get(task) === 0).sort();\n  const order: string[] = [];\n  while (ready.length > 0) {\n    const current = ready.shift() as string;\n    order.push(current);\n    for (const dependant of edges.get(current) ?? []) {\n      const next = (indegree.get(dependant) ?? 0) - 1;\n      indegree.set(dependant, next);\n      if (next === 0) insertSorted(ready, dependant);\n    }\n  }\n\n  return { order, cycle: tasks.filter((task) => !order.includes(task)).sort() };\n}\n\nfunction insertSorted(values: string[], value: string): void {\n  const index = values.findIndex((candidate) => candidate > value);\n  values.splice(index === -1 ? values.length : index, 0, value);\n}",
        usageCode:
          "console.log(solution(['build', 'test', 'deploy'], [['test', 'build'], ['deploy', 'test']]));",
        testCode:
          "import { describe, expect, it } from 'vitest';\nimport { solution } from './solution';\n\ndescribe('solution', () => {\n  it('orders branching dependencies deterministically', () => {\n    expect(solution(['deploy', 'test', 'build'], [['deploy', 'test'], ['test', 'build']])).toEqual({ order: ['build', 'test', 'deploy'], cycle: [] });\n  });\n\n  it('reports cycle members', () => {\n    expect(solution(['a', 'b'], [['a', 'b'], ['b', 'a']]).cycle).toEqual(['a', 'b']);\n  });\n});",
      },
      {
        version: 1,
        understand: {
          prompt:
            "Return a **deterministic** order in which every dependency precedes its task, and the tasks a **cycle** leaves unscheduled.",
          examples: [
            {
              input:
                "tasks = ['build', 'test', 'deploy'], dependencies = [['test', 'build'], ['deploy', 'test']]",
              output: "['build', 'test', 'deploy']",
            },
            { input: "a cycle a -> b -> a", output: "['a', 'b'] unscheduled" },
          ],
          constraints: [
            "1 <= tasks.length <= 100000",
            "Task names are unique; duplicate dependency pairs may appear.",
            "The result must be deterministic.",
          ],
          clarify: ["How should ties between ready tasks be ordered?"],
        },
        plan: {
          steps: [
            "Build an adjacency map and **indegree** count for every task.",
            "Seed a sorted queue with tasks whose indegree is zero.",
            "Remove the smallest available task, then unlock its dependants.",
            "Any task not emitted belongs to a dependency cycle.",
          ],
          complexity: {
            time: "O((V + E) log V)",
            space: "O(V + E)",
            note: "The sorted ready queue keeps the order deterministic.",
          },
        },
        edgeCases: [
          {
            name: "Branching dependencies",
            test: "orders branching dependencies deterministically",
          },
          { name: "Cycle", test: "reports cycle members" },
        ],
        explain: [
          {
            heading: "Kahn's algorithm",
            body: "A task is ready once its indegree reaches zero; what never becomes ready sits on a cycle.",
          },
        ],
        talkingPoints: [
          "Indegree captures exactly how many prerequisites remain.",
          "Sorting the ready queue makes equal-valid answers predictable.",
          "Unemitted nodes are the cycle remainder, not arbitrary failures.",
        ],
      },
    ),
  },
  {
    id: "ruby-rate-limiter",
    label: "Ruby · Sliding-window rate limiter",
    language: "ruby",
    question:
      "# Sliding-Window Rate Limiter\n\nGiven sorted request timestamps, a maximum number of requests `limit`, and an inclusive window size `window`, return a Boolean array indicating which requests are allowed. A request is allowed when fewer than `limit` previously allowed requests are inside its window.\n\n## Examples\n\n- `timestamps = [0, 1, 2, 10], limit = 2, window = 2` → `[true, true, false, true]`\n- `timestamps = [], limit = 3, window = 10` → `[]`\n\n## Constraints\n\n- `0 <= timestamps.length <= 100000`\n- `1 <= limit <= 100000`\n- `0 <= timestamps[i] <= 10^9`\n- Timestamps are sorted in non-decreasing order.\n\n## Follow-up\n\nExplain why rejected requests do not consume capacity and include RSpec tests for bursts, exact boundaries, and empty input.",
    answer: guided(
      {
        title: "Sliding-Window Rate Limiter",
        language: "ruby",
        code: "def solution(timestamps, limit, window)\n  allowed_timestamps = []\n\n  timestamps.map do |timestamp|\n    allowed_timestamps.shift while allowed_timestamps.any? && timestamp - allowed_timestamps.first > window\n\n    if allowed_timestamps.length < limit\n      allowed_timestamps << timestamp\n      true\n    else\n      false\n    end\n  end\nend",
        usageCode: "p solution([0, 1, 2, 10], 2, 2)\np solution([], 3, 10)",
        testCode:
          "require 'rspec/autorun'\n\nRSpec.describe '#solution' do\n  it 'rejects only requests beyond the burst capacity' do\n    expect(solution([0, 1, 2, 10], 2, 2)).to eq([true, true, false, true])\n  end\n\n  it 'keeps an exact boundary timestamp in the window' do\n    expect(solution([0, 2], 1, 2)).to eq([true, false])\n  end\n\n  it 'handles empty input' do\n    expect(solution([], 3, 10)).to eq([])\n  end\nend",
      },
      {
        version: 1,
        understand: {
          prompt:
            "For sorted request timestamps, return which requests are allowed when at most `limit` **allowed** requests fit in an inclusive `window`.",
          examples: [
            {
              input: "timestamps = [0, 1, 2, 10], limit = 2, window = 2",
              output: "[true, true, false, true]",
            },
            { input: "timestamps = [], limit = 3, window = 10", output: "[]" },
          ],
          constraints: [
            "0 <= timestamps.length <= 100000",
            "1 <= limit <= 100000",
            "Timestamps are sorted in non-decreasing order.",
          ],
          clarify: ["Do rejected requests count toward the limit?"],
        },
        plan: {
          steps: [
            "Keep a queue of timestamps for allowed requests only.",
            "Remove allowed timestamps older than the inclusive window.",
            "Allow the current request when the queue has capacity; otherwise reject it.",
          ],
          complexity: {
            time: "O(n)",
            space: "O(limit)",
            note: "Amortized: each timestamp is added and removed once.",
          },
        },
        edgeCases: [
          {
            name: "Burst beyond capacity",
            test: "rejects only requests beyond the burst capacity",
          },
          {
            name: "Exact window boundary",
            test: "keeps an exact boundary timestamp in the window",
          },
          { name: "Empty input", test: "handles empty input" },
        ],
        explain: [
          {
            heading: "The active window",
            body: "The queue holds only allowed requests inside the window, so its length is the capacity in use.",
          },
        ],
        talkingPoints: [
          "Rejected requests do not enter the queue, so they do not consume capacity.",
          "The comparison is inclusive: timestamps at `current - window` remain valid.",
          "A queue models the active window without rescanning old requests.",
        ],
      },
    ),
  },
];

export const exampleTemplates: readonly ExampleTemplate[] = draftTemplates.map(
  (template) => {
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
  },
);
