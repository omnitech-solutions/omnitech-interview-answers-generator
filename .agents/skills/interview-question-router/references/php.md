# PHP answer contract

Use PHP 8.2+ with `declare(strict_types=1);`, the exact required signature, one
file, standard-library features, strict comparisons where coercion is risky,
and deterministic ordering when ties matter.

Structure `code` in this order:

1. `// PROBLEM`, `// STRATEGY`, and `// COMPLEXITY` header.
2. Only earned PHPDoc shapes or boundary types.
3. The exact entry point with useful guards and readable top-to-bottom flow.
4. Focused helper functions or domain classes below the entry point when they
   own real state, invariants, reuse, or workflow boundaries.

Prefer one function, arrays, associative arrays, and readable `foreach` loops.
Use `SplQueue` for BFS. Add a helper or class only for real state, reuse,
invariants, or workflow boundaries.

Use `[COMMENT]`, `[GUARD]`, `[DOMAIN]`, `[STRATEGY]`, `[SAFETY]`, and `[TRACE]`.
Inside function bodies, comment every major logical block, including guards,
state/invariants, passes, wrapping or other consequential branches, and result
assembly. Header comments do not count. When the prompt provides an example,
put `// [TRACE] Input:` inside `solution()` with the original PHP argument
values, then keep those values consistent across later body comments. Explain
PHP key coercion,
missing-versus-null lookups, loose-comparison risks, and boundary access when
relevant. Do not label trivial assignments or loop increments.

Put representative printing in `usageCode` and focused Pest tests in
`testCode`, using `test()`/`it()` and `expect()` rather than PHPUnit-style test
classes. Do not repeat `<?php` because the Playground concatenates all three
fields into one PHP file. Use up to five meaningful cases without forcing
irrelevant categories.
