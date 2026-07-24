# Ruby answer contract

Use modern standard-library Ruby, the exact required entry-point method, one
file, domain names, small methods, `Hash` defaults, and readable `Enumerable`
operations or loops.

Structure `code` in this order:

1. `# PROBLEM`, `# STRATEGY`, and `# COMPLEXITY` header.
2. The exact entry-point method, with useful guards and readable orchestration.
3. Focused helper methods or domain classes below the entry point when they own
   real algorithm state, boundary rules, or meaningful operations.

Use `[COMMENT]`, `[GUARD]`, `[DOMAIN]`, `[STRATEGY]`, and `[SAFETY]` on
non-trivial decisions. Comments explain decisions only and must not include
example inputs, outputs, or I/O traces. Remember that negative Ruby array
indexes wrap; guard them when negative means out-of-bounds. Avoid
metaprogramming, Rails abstractions, external gems, and clever chains that are
hard to narrate.

Put exactly five representative `puts`/`p` examples in `usageCode`: typical,
empty/single, all-identical, negative/zero, and no-answer/sentinel, adapting
values without dropping a case. Put focused RSpec examples in `testCode` using
descriptive `describe`/`context`/`it` blocks and `expect`. Do not redefine the
solution in either field.
