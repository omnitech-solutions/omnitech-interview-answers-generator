# TypeScript answer contract

Use strict modern TypeScript, standard-library collections, explicit boundary
types, `readonly` where it improves clarity, the exact required signature, and
no unsafe casts or external dependencies.

Structure `code` in this order:

1. `// PROBLEM`, `// STRATEGY`, and `// COMPLEXITY` header.
2. Domain types needed by the signature.
3. The exact entry-point function, whose orchestration reads top to bottom.
4. Focused helper functions/classes below the entry point when they own current
   state, an invariant, or a meaningful algorithm step.

Prefer `Map`, `Set`, arrays, and an indexed queue before framework patterns.
Model 1–3 real domain concepts when doing so makes the algorithm easier to
explain; do not create `Helper`, `Utils`, or technical-role abstractions.
Treat `undefined`, bounds, ordering, and JavaScript runtime semantics as real.

Use `[COMMENT]`, `[GUARD]`, `[DOMAIN]`, `[STRATEGY]`, and `[SAFETY]` on every
non-trivial business, algorithm, or boundary decision. Comments must not include
example inputs, outputs, or I/O traces; keep examples in usageCode and tests.

Put exactly five representative `console.log` examples in `usageCode`: typical,
empty/single, all-identical, negative/zero, and no-answer/sentinel, adapting
values without dropping a case. Put focused Vitest tests in `testCode` using
`describe`, `it`/`test`, and `expect`. Do not redefine the solution.
