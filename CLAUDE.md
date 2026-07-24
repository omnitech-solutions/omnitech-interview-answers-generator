# Engineering contract

- Prefer the smallest complete change that makes the current requirement work.
- Simplicity comes first: choose the least complex design that satisfies every
  explicit requirement and constraint; avoid speculative layers, libraries, or
  architecture.
- Before coding, extract essential requirements, constraints, required API or
  entry point, observable behavior, and failure boundaries. Treat them as a
  completion checklist and visibly address each one.
- Keep answers specific to the problem and its domain vocabulary. Avoid generic
  boilerplate or advice detached from the supplied code and constraints.
- Treat `.rulesync/**` as the source of truth for commands, rules, and skills;
  regenerate compatibility outputs after source changes instead of editing
  generated `.agents`, `.claude`, `.cursor`, `.codex`, or `.opencode` files by
  hand.
- Keep deterministic unit and contract behavior in package tests. Put Docker,
  framework-image, browser, or provider-boundary checks in explicit integration
  tests and make the required environment visible in the command and failure.
- Keep reusable boundaries narrow: one responsibility, one public entrypoint,
  explicit input/output types, and implementation details kept private.
- Add an abstraction for a demonstrated second implementation or a real
  lifecycle/boundary—not an imagined future.
- Use domain names. Keep orchestration readable from top to bottom.
- For interview answers, put PROBLEM, STRATEGY, and COMPLEXITY comments at the
  top of the main solution. Use `[COMMENT]`, `[GUARD]`, `[DOMAIN]`,
  `[STRATEGY]`, and `[SAFETY]` labels for non-trivial decisions, invariants,
  boundary normalization, and surprising behavior. Comments must explain the
  decision only; never include example inputs, outputs, or I/O traces in source
  comments. Put examples in `usageCode` or tests instead.
- Interview answer explanations must be Markdown rendered by the Playground.
  Use concise point form for the **Question**, **Approach**, **Complexity**,
  **Edge cases**, and **Talking points** sections. Bold the key domain terms,
  invariants, trade-offs, and complexity notation so they are easy to use as
  interview talking points.
- Keep the exact required entry-point function or component above all helper
  methods and helper functions. Helpers may follow the entry point; do not
  hide the main function below implementation details.
- Keep main solution, executable usage/output, and executable tests in separate
  answer fields so the Playground can edit them as tabs and run them in order.
- Never log questions, generated code, notes, credentials, or model responses by
  default.
- Verify lint, format, types, tests, and build before claiming completion.

## Automatic routing

When the user supplies an interview question, activate the
`interview-question-router` skill, then use the
`interview-playground-controller` skill to update the open Playground through
`interview-answers playground`. Use an explicitly selected language; otherwise
detect PHP, React, TypeScript, or Ruby and default ambiguous DSA questions to
TypeScript. Produce an answer directly—there is no mock-interview mode.
