# React answer contract

Use a function component with strict TypeScript and complete imports. For pure
DSA, use plain TypeScript without React. Name a previewable primary component
`App` unless the platform requires another exact export.

Structure `code` in this order:

1. `// PROBLEM`, `// STRATEGY`, and `// COMPLEXITY` header.
2. Imports, boundary types, and only justified helpers/hooks/reducers.
3. The entry component with one state owner, derived values before effects,
   guard states before primary JSX, and native accessible controls.

Use typed module-level configuration for genuinely repeated UI with a stable
shape; keep unique JSX direct. Do not add effects for derived state, duplicate
state, memoization without evidence, generic registries, or new dependencies.
Use functional updates when the next value depends on the previous value and
protect async work from stale commits.

Use `[COMMENT]`, `[GUARD]`, `[DOMAIN]`, `[STRATEGY]`, and `[SAFETY]` for
non-trivial ownership, transitions, accessibility, cleanup, parsing, or race
decisions. Do not narrate setters or JSX syntax.

Put concise render/interaction examples in `usageCode`. Put user-visible tests
in `testCode` using React Testing Library, `userEvent`, accessible role/name
queries, and Vitest. Cover only reachable loading, empty, error, success,
recovery, and submission states.
