---
name: interview-question-router
description: Route a supplied coding-interview question to PHP, React, TypeScript, or Ruby, produce an interview-ready answer, and hand it to the live Playground controller.
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
AI provider. First extract essential requirements, constraints, required
entry-point/signature, observable behavior, and failure boundaries; use that as
a completion checklist. Start with the simplest correct solution that satisfies
it, preserve the user's relevant coding practices, and keep the answer specific
to the prompt. Avoid generic boilerplate, speculative architecture, and a
deliberately poor brute-force implementation when the direct solution is clear.

After routing, read exactly one matching reference before producing the answer:

- PHP: `references/php.md`
- React: `references/react.md`
- TypeScript: `references/typescript.md`
- Ruby: `references/ruby.md`

Return a structured answer with:

- `answerMarkdown`: Markdown with concise point-form sections in this order:
  `## Question`, `## Approach`, `## Complexity`, `## Edge cases`, and
  `## Talking points`. The Question section must turn the prompt into bullets
  for the **goal**, **inputs**, **outputs**, and **constraints**. Bold the key
  domain terms, invariants, trade-offs, and complexity notation. The Approach
  and Complexity sections must be point form, not dense paragraphs.
- `code`: the complete, screen-share-readable main solution. Put the exact
  required entry-point function or component above all helper methods/functions;
  helpers follow the entry point. Do not put example inputs, outputs, or I/O
  traces in source comments.
- `usageCode`: executable representative usage that prints ordinary output;
- `testCode`: focused executable tests covering the example, boundaries, and a
  meaningful failure-prone case;
- time and space complexity;
- a short dry run only when it materially clarifies the logic;
- senior-level trade-offs without speculative architecture.

Keep the three code fields separately executable in the Playground's ordered
bundle: main solution, usage/output, then tests. Do not redefine the solution in
usage or tests. For PHP, omit additional `<?php` tags from usage and tests.

Pass the completed structured answer to the `interview-playground-controller`
skill. Do not persist unless the user requests it.
