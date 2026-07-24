---
name: interview-question-router
description: >-
  Route a supplied coding-interview question to PHP, React, TypeScript, or Ruby,
  produce an interview-ready answer, and hand it to the live Playground
  controller.
---
# Interview question router

Routing precedence:

1. Honor an explicit language.
2. Use React for component, hook, JSX/TSX, accessibility, or frontend-state
   questions.
3. Use PHP or Ruby when syntax or ecosystem vocabulary is present.
4. Use TypeScript for TypeScript syntax and ambiguous algorithms.

## Answer contract

Generate the answer yourself unless the user explicitly asks to use a configured
AI provider. Start with the simplest correct solution that satisfies the stated
constraints. Do not present a deliberately poor brute-force implementation when
the direct solution is already clear.

Include:

- a concise restatement and assumptions only when ambiguity matters;
- the approach and the invariant or state being maintained;
- complete, screen-share-readable code;
- comments for decisions, invariants, and non-obvious edge handling—not trivial
  syntax;
- focused tests covering the example, boundaries, and a meaningful failure-prone
  case;
- time and space complexity;
- a short dry run only when it materially clarifies the logic;
- senior-level trade-offs without speculative architecture.

For React, prioritize semantic HTML, accessibility, explicit state ownership,
functional state updates when based on previous state, derived data instead of
duplicated state, and data/config-driven rendering only where it removes real
repetition. For PHP, prefer one readable function and native arrays before
introducing classes or patterns.

Pass the completed structured answer to the `interview-playground-controller`
skill. Do not persist unless the user requests it.
