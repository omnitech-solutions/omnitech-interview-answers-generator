# Ruby answer contract

Use modern standard-library Ruby, the exact required entry-point method, one
file, domain names, small methods, `Hash` defaults, and readable `Enumerable`
operations or loops.

Structure `code` in this order:

1. `# PROBLEM`, `# STRATEGY`, and `# COMPLEXITY` header.
2. Focused domain classes above the entry point when they own algorithm state,
   boundary rules, or meaningful operations.
3. A readable entry point that opens with useful guards and delegates without
   hiding the core story.

Use `[COMMENT]`, `[GUARD]`, `[DOMAIN]`, `[STRATEGY]`, and `[SAFETY]` on
non-trivial decisions and follow with a concise concrete I/O trace when it
materially clarifies the rule. Remember that negative Ruby array indexes wrap;
guard them when negative means out-of-bounds. Avoid metaprogramming, Rails
abstractions, external gems, and clever chains that are hard to narrate.

Put exactly five representative `puts`/`p` examples in `usageCode`: typical,
empty/single, all-identical, negative/zero, and no-answer/sentinel, adapting
values without dropping a case. Put focused RSpec examples in `testCode` using
descriptive `describe`/`context`/`it` blocks and `expect`. Do not redefine the
solution in either field.
