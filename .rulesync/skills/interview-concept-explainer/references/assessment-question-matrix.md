# Assessment question matrix

Use this matrix to check breadth and calibrate answer shape for a 60-minute
full-stack interview. It is not a script and should not make individual answers
exhaustive.

## React and frontend

| Question | Type | Interview signal |
| --- | --- | --- |
| How does React decide when to re-render? | Mechanism | Triggers vs commit, equality, non-triggers |
| `useEffect` vs `useLayoutEffect`? | Comparison | Timing, paint, measured DOM |
| When does an effect cleanup run? | Mechanism | Before next effect and unmount |
| Controlled vs uncontrolled input? | Comparison | Ownership, validation, integration |
| Local state vs context vs external store? | Trade-off | Scope, update frequency, coupling |
| Why can context cause broad renders? | Mechanism | Consumer subscription and value identity |
| When does `React.memo` help? | Trade-off | Stable props, render cost, shallow comparison |
| `useMemo` vs `useCallback`? | Comparison | Memoized value vs function identity |
| Why are keys important? | Mechanism | Identity, state preservation, reorder behavior |
| What does Strict Mode expose? | Mechanism | Impure render/effect cleanup in development |
| How do stale closures happen? | Troubleshooting | Captured render values and dependencies |
| How do you prevent request races? | Practical API | Abort/identity, cleanup, latest result |
| How do you optimize a large list? | Trade-off | Measure, memoize, virtualize, paginate |
| What causes hydration mismatch? | Troubleshooting | Server/client nondeterminism |
| How do you make a custom control accessible? | Practical API | Native semantics first, keyboard, name/state |
| Client vs server rendering? | Comparison | TTFB, interactivity, SEO, infrastructure |

## Browser and web fundamentals

| Question | Type | Interview signal |
| --- | --- | --- |
| How does the event loop order work? | Mechanism | Stack, microtasks, tasks, rendering |
| Debounce vs throttle? | Comparison | Final value vs bounded frequency |
| What happens after entering a URL? | System flow | DNS, TCP/TLS, HTTP, parse/render |
| `async` vs `defer` scripts? | Comparison | Parse blocking and execution order |
| How does browser rendering work? | System flow | DOM/CSSOM, layout, paint, composite |
| Reflow vs repaint? | Comparison | Geometry vs pixels and performance |
| HTTP caching vs application caching? | Comparison | Validators, freshness, invalidation |
| `Cache-Control` vs `ETag`? | Comparison | Avoid request vs conditional validation |
| What does CORS protect? | Security | Browser read boundary, not server auth |
| Cookies vs local/session storage? | Comparison | Transport, lifetime, XSS/CSRF |
| How do `SameSite`, `HttpOnly`, and `Secure` help? | Security | CSRF, script access, transport |
| HTTP/1.1 vs HTTP/2 vs HTTP/3? | Comparison | Multiplexing, transport, head-of-line blocking |
| What makes an API idempotent? | Mechanism | Repeat effect and idempotency keys |
| How do you handle frontend failures? | Troubleshooting | Loading/error/empty, retry, observability |

## Backend and full-stack

| Question | Type | Interview signal |
| --- | --- | --- |
| REST vs GraphQL? | Trade-off | Consumer shape, caching, complexity |
| Authentication vs authorization? | Comparison | Identity vs permission |
| Session vs JWT authentication? | Trade-off | Revocation, state, transport/security |
| Where should validation happen? | System boundary | Client UX plus authoritative server checks |
| Optimistic vs pessimistic locking? | Trade-off | Contention and conflict behavior |
| What does a transaction guarantee? | Mechanism | Atomic boundary and isolation |
| SQL vs NoSQL? | Trade-off | Data/access pattern, consistency, operations |
| How do indexes help and hurt? | Trade-off | Read path vs write/storage cost |
| N+1 queries: detect and fix? | Troubleshooting | Observability, eager/batch loading |
| When should work enter a queue? | Trade-off | Latency, reliability, eventual completion |
| How do retries become safe? | Mechanism | Idempotency, backoff, dead letters |
| Cache-aside flow and failure modes? | System flow | Miss/load/write, staleness, stampede |
| How do you invalidate cache? | Trade-off | Ownership, TTL, events, versioning |
| Offset vs cursor pagination? | Comparison | Stability and access pattern |
| How do you evolve an API safely? | System design | Compatibility, versioning, rollout |
| How do you handle partial failure? | System design | Timeout, retry, compensation, degradation |
| Logs vs metrics vs traces? | Comparison | Event detail, aggregate signal, request path |
| How do you protect an API? | Security | AuthN/Z, validation, rate limits, audit |
| Monolith vs microservices? | Trade-off | Team/domain boundary before deployment count |
| How would you debug a slow request? | Troubleshooting | Measure across client, network, app, database |

## DSA and coding discussion

| Question | Pattern | Required signal |
| --- | --- | --- |
| Pair sums to target | Hash map / two pointers | Lookup invariant; sorting trade-off |
| First non-repeating character | Frequency map | Count then ordered scan |
| Group anagrams | Hash map | Canonical key and total character cost |
| Longest unique substring | Sliding window | Last seen / left-bound invariant |
| Minimum-size target subarray | Sliding window | Positive-number assumption |
| Valid palindrome with punctuation | Two pointers | Normalization and inward invariant |
| Merge sorted arrays | Two pointers | Monotonic consumption |
| Product except self | Prefix/suffix | No division and output-space convention |
| Top-k frequent values | Heap / buckets | `n` versus `k` trade-off |
| Valid parentheses | Stack | Most recent unmatched opener |
| Merge intervals | Sort + scan | Current merged interval invariant |
| Binary search boundary | Binary search | Search-space contract and off-by-one control |
| Detect linked-list cycle | Fast/slow pointers | Relative speed invariant |
| Tree level order | BFS queue | Level boundary and `O(width)` space |
| Path exists in graph | BFS/DFS | Visited set prevents cycles |
| Generate combinations | Backtracking | Choice, recurse, undo |

For every DSA explanation, surface:

- input assumptions and required output;
- brute-force baseline before optimization when useful;
- the invariant in one sentence;
- `Time` and `Space`, including sorting or output storage;
- edge cases that can change correctness;
- working code before optional optimization.

## Experience and communication

| Question | Evidence shape |
| --- | --- |
| Tell me about a difficult modernization | Boundary, incremental plan, measurable result |
| Describe a cross-team disagreement | Shared constraint, decision process, outcome |
| Tell me about a production incident | Detection, containment, root cause, prevention |
| Describe a performance improvement | Baseline, measured bottleneck, change, result |
| Tell me about an ambiguous project | Assumptions, alignment, iterative delivery |
| How have you improved developer velocity? | Reusable platform/process and metric |
| Describe a security trade-off | Threat, control, usability/operations cost |
| Tell me about mentoring an engineer | Observed need, specific support, growth signal |
| Describe a failed decision | Ownership, evidence, correction, learned guardrail |
| How do you communicate while coding? | Restate, assumptions, invariant, tests, complexity |

Use the candidate experience matrix to select the smallest verified story that
answers the question. Do not combine achievements from different roles.
