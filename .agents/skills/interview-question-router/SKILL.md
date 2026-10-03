---
name: interview-question-router
description: Route interview questions to non-technical briefing or coding answers and hand them to the live Playground controller.
---

# Interview question router

Routing precedence:

1. Route personal background, recruiter, motivation, leadership, and behavioural
   questions to a non-technical briefing, even when a technology is mentioned.
   Use an explicitly imported candidate profile and supplied company/role context.
   Ask for missing evidence or mark a gap; never invent a career claim or read an
   implicit Desktop or cross-checkout profile path. Use the public `interview-answers
   briefing` commands in the playground-controller skill. Propose for review,
   apply only after review, and save only when requested. Do not enter mock
   interview mode.
2. For coding questions, honor an explicit language.
3. Use React for component, hook, JSX/TSX, accessibility, or frontend-state
   questions.
4. Use PHP or Ruby when syntax or ecosystem vocabulary is present.
5. Use TypeScript for TypeScript syntax and ambiguous algorithms.

## Answer contract

Generate the answer yourself unless the user explicitly asks to use a configured
AI provider. First extract essential requirements, constraints, required
entry-point/signature, observable behavior, and failure boundaries; use that as
a completion checklist. Start with the simplest correct solution that satisfies
it, preserve the user's relevant coding practices, and keep the answer specific
to the prompt. Avoid generic boilerplate, speculative architecture, and a
deliberately poor brute-force implementation when the direct solution is clear.
Do not invent validation or change the required return contract. Instead, make
the algorithm total for every input allowed by the stated constraints: guard
empty or missing-result paths when relevant, prevent out-of-bounds access and
non-terminating loops, and preserve duplicates, ordering, and numeric semantics
when the problem makes them observable.

After routing, read exactly one matching reference before producing the answer:

- PHP: `references/php.md`
- React: `references/react.md`
- TypeScript: `references/typescript.md`
- Ruby: `references/ruby.md`

Return a structured answer with:

- `guide`: the structured answer the Workspace stages show. The Playground
  renders the answer's Markdown (`## Question`, `## Approach`,
  `## Complexity`, `## Edge cases`, `## Talking points`) from it, so never
  write `answerMarkdown` yourself. Shape (version `1`):
  - `understand`: `prompt` (the **goal**, **inputs**, and **outputs** in one or
    two sentences), `examples` (up to three `{input, output, note?}`),
    `constraints`, and `clarify` (questions worth asking before coding);
  - `plan`: `steps` (two to six point-form steps) and `complexity`
    `{time, space, note?}` in Big-O;
  - `edgeCases`: `{name, test?}`, where `test` is the exact title of the test
    in `testCode` that covers the case;
  - `explain`: `{heading, body}` sections for a two-minute spoken answer (the
    problem, the approach, the trade-offs);
  - `talkingPoints`: exactly three.
  Keep every item short enough to say aloud. Bold the key domain terms,
  invariants, trade-offs, and complexity notation with `**double asterisks**`.
- `code`: the complete, screen-share-readable main solution. Put the exact
  required entry-point function or component above all helper methods/functions;
  helpers follow the entry point. Inside function/component bodies, add a
  concise labeled comment immediately before each major logical block,
  including guards, state/invariants, algorithmic passes, consequential
  branches, and result assembly. Header comments do not count. When the original
  prompt supplies an example, include `[TRACE] Input:` inside the entry-point
  body with the actual method/function argument values copied from that example.
  Keep those values consistent throughout later trace comments; never invent a
  second example inside the code.
- `usageCode`: executable representative usage that prints ordinary output;
- `testCode`: focused executable tests covering the example, boundaries, and a
  meaningful failure-prone case. Derive cases from the actual contract rather
  than mechanically testing language oddities. Include the ordinary example,
  the smallest valid input, the largest or structurally stressful practical
  case, and relevant cases such as empty input, duplicates, negative/zero
  values, no solution, repeated calls, or mutation safety. Do not assert
  behavior outside the prompt's constraints;
- time and space complexity;
- a short dry run only when it materially clarifies the logic;
- senior-level trade-offs without speculative architecture.

Keep the three code fields separately executable in the Playground's ordered
bundle: main solution, usage/output, then tests. Do not redefine the solution in
usage or tests. For PHP, omit additional `<?php` tags from usage and tests.
Keep the main solution portable to a browser interview IDE: use the exact
signature, standard language/runtime APIs, deterministic logic, no filesystem,
network, timers, environment variables, external packages, test-only imports,
or process termination. Place framework-specific test imports only in
`testCode`. Use `[COMMENT]`, `[GUARD]`, `[DOMAIN]`, `[STRATEGY]`, `[SAFETY]`,
and `[TRACE]` consistently. Comments must explain guards, invariants, major
logic, and decisions that help the candidate communicate; do not narrate
obvious syntax.

Pass the completed structured answer to the `interview-playground-controller`
skill. Do not persist unless the user requests it.
