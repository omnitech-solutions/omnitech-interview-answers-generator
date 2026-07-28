import type { LibraryItemInput } from "@omnitech/interview-contracts";

const verifiedAt = "2026-07-27";

function official(
  slug: string,
  title: string,
  summary: string,
  collection: string,
  tags: string[],
  publisher: string,
  canonicalUrl: string,
  body: string,
): LibraryItemInput {
  return {
    slug,
    title,
    summary,
    body,
    contentType: "official-reference",
    collection,
    tags,
    source: {
      publisher,
      canonicalUrl,
      official: true,
      ...(publisher === "React" ? { version: "19.2" } : {}),
      lastVerifiedAt: verifiedAt,
    },
  };
}

function guide(
  slug: string,
  title: string,
  summary: string,
  collection: string,
  tags: string[],
  body: string,
): LibraryItemInput {
  return {
    slug,
    title,
    summary,
    body,
    contentType: "concept-guide",
    collection,
    tags,
  };
}

function sheet(
  slug: string,
  title: string,
  summary: string,
  collection: string,
  tags: string[],
  body: string,
): LibraryItemInput {
  return {
    slug,
    title,
    summary,
    body,
    contentType: "cheat-sheet",
    collection,
    tags,
  };
}

function pattern(
  slug: string,
  title: string,
  summary: string,
  tags: string[],
  body: string,
): LibraryItemInput {
  return {
    slug,
    title,
    summary,
    body,
    contentType: "dsa-pattern",
    collection: "dsa",
    tags,
  };
}

export const interviewLibrarySeed: LibraryItemInput[] = [
  official(
    "react-state",
    "React state",
    "State ownership, snapshots, and functional updates.",
    "react",
    ["react", "state", "hooks"],
    "React",
    "https://react.dev/learn/state-as-a-snapshot",
    `# React state

## Core model

State is a component's memory. Each render receives a snapshot, so an event
handler observes the values from the render that created it.

## Interview answer

Keep one owner for each value, derive rather than duplicate, and use a
functional update when the next value depends on the previous value.`,
  ),
  official(
    "react-effects",
    "React effects",
    "Synchronize React with systems outside React.",
    "react",
    ["react", "effects", "hooks"],
    "React",
    "https://react.dev/learn/synchronizing-with-effects",
    `# React effects

## Use effects for synchronization

An effect connects rendering to an external system such as a network,
subscription, timer, or browser API. It is not a general event handler.

## Safety

Declare every reactive dependency and return cleanup that reverses setup.
Strict Mode's extra development setup-cleanup cycle exposes missing cleanup.`,
  ),
  official(
    "react-sharing-state",
    "Sharing React state",
    "Lift state to the closest common owner and preserve one source of truth.",
    "react",
    ["react", "state-management", "derived-state"],
    "React",
    "https://react.dev/learn/sharing-state-between-components",
    `# Sharing state

## Ownership

Lift shared state to the closest common ancestor. Pass values and events down
instead of maintaining synchronized copies.

## Derived values

Compute filtered collections, totals, and selected objects from source state
during rendering unless the computation is measurably expensive.`,
  ),
  official(
    "react-memoization",
    "React memoization",
    "Use memoization after profiling identifies avoidable render work.",
    "react",
    ["react", "performance", "memoization"],
    "React",
    "https://react.dev/reference/react/useMemo",
    `# React memoization

## Tools

\`useMemo\` caches a calculation, \`useCallback\` caches a function identity,
and \`memo\` can skip a child render when props are unchanged.

## Trade-off

Memoization adds comparison and maintenance cost. Measure with the profiler and
apply it only where stable identities avoid meaningful work.`,
  ),
  official(
    "react-transitions",
    "React transitions",
    "Keep urgent input responsive while non-urgent rendering catches up.",
    "react",
    ["react", "concurrency", "performance"],
    "React",
    "https://react.dev/reference/react/useTransition",
    `# React transitions

## Priority

A transition marks a state update as non-urgent. Urgent input can update while
React prepares expensive results in the background.

## Boundary

Transitions do not debounce network requests. Debounce controls request
frequency; transitions control rendering priority.`,
  ),
  official(
    "react-strict-mode",
    "React Strict Mode",
    "Development checks that expose impure rendering and missing cleanup.",
    "react",
    ["react", "strict-mode", "effects"],
    "React",
    "https://react.dev/reference/react/StrictMode",
    `# Strict Mode

## Development behavior

Strict Mode intentionally repeats selected rendering and effect lifecycle work
in development. Production does not perform the extra checks.

## Design response

Render functions must be pure and effect cleanup must fully reverse setup.
Network commits should also verify that their request generation is current.`,
  ),
  official(
    "react-pure-components",
    "Keeping React components pure",
    "Why rendering must behave like a pure calculation.",
    "react",
    ["react", "components", "rendering", "purity"],
    "React",
    "https://react.dev/learn/keeping-components-pure",
    `# Keeping components pure

## Render contract

A component should return the same JSX for the same props, state, and context.
Do not mutate values created before rendering or perform external work during
render.

## Interview talking point

Purity lets React pause, restart, and repeat rendering safely. Put user-driven
work in event handlers and external synchronization in effects.`,
  ),
  official(
    "react-preserving-resetting-state",
    "Preserving and resetting state",
    "How position, type, and keys control component state identity.",
    "react",
    ["react", "state", "keys", "identity"],
    "React",
    "https://react.dev/learn/preserving-and-resetting-state",
    `# Preserving and resetting state

## Identity

React associates state with a component's position in the rendered tree.
Keeping the same component type at the same position preserves its state.

## Reset deliberately

Change the component's key or render it at a different position when the
product behavior requires fresh state. Keys express identity; they are not
only a list-warning fix.`,
  ),
  official(
    "react-reducer",
    "Extracting state logic into a reducer",
    "Use a reducer when related transitions need one explicit state machine.",
    "react",
    ["react", "use-reducer", "state-management", "reducers"],
    "React",
    "https://react.dev/learn/extracting-state-logic-into-a-reducer",
    `# Reducers

## When to use one

Use a reducer when several events update related state and the transitions are
hard to understand across separate setters.

## Boundary

The reducer must stay pure. Events dispatch descriptive actions; the reducer
computes the next state. This centralizes transition logic without making
server data client state.`,
  ),
  official(
    "react-context",
    "Passing data deeply with context",
    "Share stable cross-cutting values without threading every intermediate prop.",
    "react",
    ["react", "context", "state-management", "performance"],
    "React",
    "https://react.dev/learn/passing-data-deeply-with-context",
    `# Context

## Appropriate use

Context is useful for cross-cutting values such as theme, locale, auth, or a
reducer-backed feature state used across a subtree.

## Trade-off

Changing a provider value re-renders its consumers. Keep ownership explicit,
split unrelated contexts, and stabilize provider values only when profiling
shows meaningful avoidable work.`,
  ),
  official(
    "react-refs-dom",
    "Manipulating the DOM with refs",
    "Use refs as an escape hatch for imperative browser APIs.",
    "react",
    ["react", "refs", "dom", "focus"],
    "React",
    "https://react.dev/learn/manipulating-the-dom-with-refs",
    `# DOM refs

## Use cases

Refs are appropriate for focus, selection, measurement, scrolling, media, and
integration with imperative libraries.

## Safety

Read or mutate DOM refs in event handlers or effects, not during rendering.
Prefer declarative props for anything React can express directly.`,
  ),
  official(
    "react-custom-hooks",
    "Reusing logic with custom Hooks",
    "Extract reusable stateful behavior while keeping state instances independent.",
    "react",
    ["react", "hooks", "custom-hooks", "reuse"],
    "React",
    "https://react.dev/learn/reusing-logic-with-custom-hooks",
    `# Custom Hooks

## Purpose

A custom Hook packages reusable stateful behavior and synchronization. Its
name begins with \`use\`, and it can call other Hooks at the top level.

## Important distinction

Custom Hooks share logic, not state. Each call receives an independent state
instance unless the Hook connects callers to an intentional external store.`,
  ),
  official(
    "react-deferred-value",
    "useDeferredValue",
    "Let expensive rendering trail an urgent input update.",
    "react",
    ["react", "use-deferred-value", "concurrency", "performance"],
    "React",
    "https://react.dev/reference/react/useDeferredValue",
    `# useDeferredValue

## Behavior

\`useDeferredValue\` returns a value that may lag behind its latest input so an
urgent interaction can remain responsive while expensive content catches up.

## Boundary

It does not reduce network traffic. Debounce requests separately, preserve the
previous result intentionally, and expose stale content accessibly.`,
  ),
  official(
    "react-use",
    "React use API",
    "Read a promise or context resource within a Suspense-aware render.",
    "react",
    ["react", "use", "suspense", "async"],
    "React",
    "https://react.dev/reference/react/use",
    `# React use API

## Purpose

\`use\` reads a resource such as a promise or context during rendering. A
pending promise suspends the component until the nearest Suspense boundary can
continue.

## Interview boundary

The resource must have stable ownership. Avoid creating an uncached promise on
every client render, and pair rejected resources with an error boundary.`,
  ),
  official(
    "react-suspense",
    "React Suspense",
    "Coordinate declarative loading boundaries for Suspense-enabled resources.",
    "react",
    ["react", "suspense", "loading", "streaming"],
    "React",
    "https://react.dev/reference/react/Suspense",
    `# Suspense

## Boundary

Suspense displays a fallback while a supported child resource is unavailable.
Place boundaries around meaningful loading regions rather than replacing the
entire screen.

## Trade-off

Suspense coordinates rendering; it is not by itself a data-fetching strategy.
Framework or server-state integrations must provide caching, ownership, and
error handling.`,
  ),
  official(
    "react-memo",
    "React memo",
    "Skip a component render when its props are unchanged and the work matters.",
    "react",
    ["react", "memo", "performance", "rendering"],
    "React",
    "https://react.dev/reference/react/memo",
    `# React memo

## Optimization

\`memo\` can skip rendering when props compare equal. It is a performance
optimization, never a correctness requirement.

## Use after measuring

Unstable object and function props defeat memoization. First keep rendering
pure and state local; then use the profiler to confirm that skipped child work
outweighs comparison and maintenance cost.`,
  ),
  official(
    "react-use-state",
    "useState",
    "Declare local component state and update it for the next render.",
    "react",
    ["react", "hooks", "use-state", "state"],
    "React",
    "https://react.dev/reference/react/useState",
    `# useState

## Signature

\`const [state, setState] = useState(initialState)\`

## Use it for

Store local source state that affects rendering. The setter schedules a new
render; it does not mutate the value captured by the current render.

## Interview caveat

Use a functional update when the next state depends on the previous state.
Pass an initializer function when initial computation is expensive, and avoid
storing values that can be derived during rendering.`,
  ),
  official(
    "react-use-effect",
    "useEffect",
    "Synchronize a component with an external system after rendering.",
    "react",
    ["react", "hooks", "use-effect", "effects"],
    "React",
    "https://react.dev/reference/react/useEffect",
    `# useEffect

## Signature

\`useEffect(setup, dependencies?)\`

## Use it for

Connect to network subscriptions, browser APIs, timers, or imperative
libraries. Return cleanup that fully reverses setup.

## Interview caveat

Effects are not a general place for derived state or user events. Include every
reactive dependency and design setup-cleanup to survive Strict Mode's
development replay.`,
  ),
  official(
    "react-use-context",
    "useContext",
    "Read and subscribe to the nearest matching context provider.",
    "react",
    ["react", "hooks", "use-context", "context"],
    "React",
    "https://react.dev/reference/react/useContext",
    `# useContext

## Signature

\`const value = useContext(SomeContext)\`

## Behavior

The component reads the closest provider above it and re-renders when that
provider's value changes.

## Interview caveat

Context avoids prop threading but does not replace intentional state
ownership. Split unrelated values and avoid recreating provider objects when
their identity would trigger unnecessary consumer work.`,
  ),
  official(
    "react-use-reducer",
    "useReducer",
    "Manage related state transitions with a pure reducer and explicit actions.",
    "react",
    ["react", "hooks", "use-reducer", "reducers"],
    "React",
    "https://react.dev/reference/react/useReducer",
    `# useReducer

## Signature

\`const [state, dispatch] = useReducer(reducer, initialArg, init?)\`

## Use it for

Choose a reducer when several events update related fields and named actions
make the transition model easier to reason about and test.

## Interview caveat

Reducers must be pure. Keep remote server data in an appropriate server-state
layer rather than moving it into a reducer solely for centralization.`,
  ),
  official(
    "react-use-ref",
    "useRef",
    "Retain a mutable value across renders without causing a render.",
    "react",
    ["react", "hooks", "use-ref", "refs", "dom"],
    "React",
    "https://react.dev/reference/react/useRef",
    `# useRef

## Signature

\`const ref = useRef(initialValue)\`

## Use it for

Hold a DOM node, timer ID, previous request token, or mutable infrastructure
that must survive renders but should not appear in the UI.

## Interview caveat

Changing \`ref.current\` does not trigger rendering. Use state instead when the
value affects what the user sees, and avoid reading or writing refs during
render except for predictable initialization.`,
  ),
  official(
    "react-use-imperative-handle",
    "useImperativeHandle",
    "Expose a small imperative handle through a ref.",
    "react",
    ["react", "hooks", "use-imperative-handle", "refs"],
    "React",
    "https://react.dev/reference/react/useImperativeHandle",
    `# useImperativeHandle

## Signature

\`useImperativeHandle(ref, createHandle, dependencies?)\`

## Use it for

Expose a deliberate command surface such as \`focus()\` or \`reset()\` instead
of handing a parent the entire DOM node.

## Interview caveat

Imperative handles are an escape hatch. Prefer props and declarative state
when the interaction can be represented through normal data flow.`,
  ),
  official(
    "react-use-layout-effect",
    "useLayoutEffect",
    "Measure or adjust layout before the browser paints.",
    "react",
    ["react", "hooks", "use-layout-effect", "layout"],
    "React",
    "https://react.dev/reference/react/useLayoutEffect",
    `# useLayoutEffect

## Timing

\`useLayoutEffect(setup, dependencies?)\` runs after DOM updates but before the
browser paints, making it suitable for measurement that must prevent visible
layout movement.

## Interview caveat

It blocks painting and does not run during server rendering. Prefer
\`useEffect\` unless pre-paint measurement or mutation is genuinely required.`,
  ),
  official(
    "react-use-memo",
    "useMemo",
    "Cache an expensive calculation between renders when dependencies are unchanged.",
    "react",
    ["react", "hooks", "use-memo", "performance"],
    "React",
    "https://react.dev/reference/react/useMemo",
    `# useMemo

## Signature

\`const value = useMemo(calculateValue, dependencies)\`

## Use it for

Cache a measured expensive derivation or stabilize a value when that identity
enables another proven optimization.

## Interview caveat

It is a performance hint, not a semantic guarantee. Keep calculations pure and
do not add memoization before profiling shows useful avoided work.`,
  ),
  official(
    "react-use-callback",
    "useCallback",
    "Cache a function identity between renders.",
    "react",
    ["react", "hooks", "use-callback", "performance"],
    "React",
    "https://react.dev/reference/react/useCallback",
    `# useCallback

## Signature

\`const fn = useCallback(callback, dependencies)\`

## Use it for

Stabilize a callback when a memoized child or another Hook meaningfully
benefits from identity equality.

## Interview caveat

It does not prevent function creation or make logic faster by itself. Declare
all reactive dependencies and prefer removing unnecessary effect dependencies
over memoizing everything.`,
  ),
  official(
    "react-use-transition",
    "useTransition",
    "Mark non-urgent state updates and expose their pending state.",
    "react",
    ["react", "hooks", "use-transition", "concurrency"],
    "React",
    "https://react.dev/reference/react/useTransition",
    `# useTransition

## Signature

\`const [isPending, startTransition] = useTransition()\`

## Use it for

Keep urgent input responsive while React prepares a non-urgent navigation or
expensive rendering update.

## Interview caveat

Transitions do not debounce requests, and updates that control text inputs
cannot be transitions. Announce pending state without unnecessarily replacing
useful existing content.`,
  ),
  official(
    "react-use-id",
    "useId",
    "Generate stable IDs for accessible relationships.",
    "react",
    ["react", "hooks", "use-id", "accessibility"],
    "React",
    "https://react.dev/reference/react/useId",
    `# useId

## Signature

\`const id = useId()\`

## Use it for

Connect accessible attributes such as \`aria-describedby\` to elements with
stable IDs that remain consistent across server rendering and hydration.

## Interview caveat

\`useId\` is not for list keys. Keys must come from the identity of the data
being rendered.`,
  ),
  official(
    "react-use-sync-external-store",
    "useSyncExternalStore",
    "Subscribe safely to mutable data owned outside React.",
    "react",
    ["react", "hooks", "use-sync-external-store", "external-store"],
    "React",
    "https://react.dev/reference/react/useSyncExternalStore",
    `# useSyncExternalStore

## Signature

\`const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot?)\`

## Use it for

Integrate an external store or browser subscription with concurrent rendering
and server hydration guarantees.

## Interview caveat

\`getSnapshot\` must return a cached, immutable snapshot until the store
changes. Most application components should consume a library adapter rather
than implementing this integration repeatedly.`,
  ),
  official(
    "react-use-action-state",
    "useActionState",
    "Manage state produced by an Action, including pending form work.",
    "react",
    ["react", "hooks", "use-action-state", "forms", "actions"],
    "React",
    "https://react.dev/reference/react/useActionState",
    `# useActionState

## Signature

\`const [state, action, isPending] = useActionState(fn, initialState, permalink?)\`

## Use it for

Connect an Action's result and pending state to a form-oriented interface,
including progressive enhancement with supported frameworks.

## Interview caveat

Treat validation failures as expected state and transport failures as errors.
Do not duplicate the same action result in another local state variable.`,
  ),
  official(
    "react-use-optimistic",
    "useOptimistic",
    "Show an optimistic state while an Action is in progress.",
    "react",
    ["react", "hooks", "use-optimistic", "actions", "state"],
    "React",
    "https://react.dev/reference/react/useOptimistic",
    `# useOptimistic

## Signature

\`const [optimisticState, addOptimistic] = useOptimistic(state, updateFn?)\`

## Use it for

Provide immediate feedback for an Action while retaining the authoritative
state as the eventual source of truth.

## Interview caveat

Optimistic updates need reconciliation and an accessible failure path. Use a
stable item identity so a failed or reordered response does not visibly
regress unrelated state.`,
  ),
  guide(
    "react-accessibility",
    "Accessible React controls",
    "Semantic controls, focus management, and useful async announcements.",
    "react",
    ["react", "accessibility", "focus"],
    `# Accessible controls

## Start with semantics

Use native buttons, inputs, labels, headings, and lists before adding ARIA.

## Async states

Announce meaningful loading completion and errors without announcing every
keystroke. Move focus deliberately when dialogs or detail panels open and
restore it when they close.`,
  ),
  guide(
    "react-render-performance",
    "React rendering performance",
    "Profile, virtualize large lists, and optimize the measured bottleneck.",
    "react",
    ["react", "performance", "virtualization"],
    `# Rendering performance

## Order of operations

Measure first, reduce unnecessary state, keep components pure, and virtualize
large collections. Memoize only after identifying expensive repeated work.

## Talking point

Rendering thousands of rows is primarily a DOM-volume problem; virtualization
usually matters more than callback identity.`,
  ),
  official(
    "javascript-event-loop",
    "JavaScript event loop",
    "Tasks, microtasks, rendering opportunities, and run-to-completion.",
    "web",
    ["javascript", "event-loop", "async"],
    "MDN",
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop",
    `# Event loop

## Execution

JavaScript jobs run to completion. Promise reactions use the microtask queue,
which drains before the browser takes the next task.

## Interview implication

Long synchronous work blocks input and paint. Split or move expensive work, and
never assume a timer fires at an exact wall-clock time.`,
  ),
  official(
    "http-caching",
    "HTTP caching",
    "Freshness, validation, and cache-control trade-offs.",
    "web",
    ["http", "caching", "browser"],
    "MDN",
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching",
    `# HTTP caching

## Freshness and validation

\`Cache-Control\` defines reuse policy. Validators such as ETag let a stale
cache ask whether its representation changed.

## Trade-off

Long freshness improves latency but delays updates. Versioned immutable assets
support aggressive caching; personalized responses require careful cache keys.`,
  ),
  official(
    "cors",
    "Cross-Origin Resource Sharing",
    "How servers explicitly permit browser cross-origin requests.",
    "web",
    ["cors", "http", "security"],
    "MDN",
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS",
    `# CORS

## Browser enforcement

CORS is an HTTP-header protocol enforced by browsers. It does not replace
authentication or protect a server from non-browser callers.

## Preflight

Requests outside the simple-request rules may send an OPTIONS preflight before
the actual request.`,
  ),
  official(
    "web-storage",
    "Web storage",
    "Session and persistent synchronous key-value storage.",
    "web",
    ["browser", "storage", "security"],
    "MDN",
    "https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API",
    `# Web storage

## Scope

\`sessionStorage\` is scoped to a tab session. \`localStorage\` persists by
origin across browser sessions.

## Trade-off

Both APIs are synchronous and store strings. Avoid large payloads and never
treat browser storage as a safe place for secrets.`,
  ),
  guide(
    "browser-rendering-pipeline",
    "Browser rendering pipeline",
    "Style, layout, paint, and compositing in practical performance analysis.",
    "web",
    ["browser", "rendering", "performance"],
    `# Rendering pipeline

## Pipeline

DOM and CSSOM changes can lead to style calculation, layout, paint, and
compositing. The exact work depends on the property and browser.

## Practical answer

Batch DOM reads and writes, avoid layout-dependent work in hot loops, animate
transform and opacity when appropriate, and verify with browser tooling.`,
  ),
  guide(
    "cookies-and-sessions",
    "Cookies and sessions",
    "Browser cookie controls and server-side session identity.",
    "web",
    ["cookies", "sessions", "security"],
    `# Cookies and sessions

## Model

A cookie is browser-managed request metadata. A session commonly stores the
actual state server-side and uses a random cookie value as its lookup key.

## Security

Use Secure, HttpOnly, and an appropriate SameSite policy. Rotate identifiers
after privilege changes and enforce expiry on the server.`,
  ),
  sheet(
    "frontend-trade-offs",
    "Frontend trade-offs",
    "A compact framework for discussing client-side design decisions.",
    "web",
    ["frontend", "trade-offs", "architecture"],
    `# Frontend trade-offs

## Framework

State the user constraint, identify the source of truth, choose the simplest
rendering and data boundary, then name the latency, complexity, accessibility,
and failure trade-offs.

## Useful contrasts

- local state versus URL state;
- client filtering versus server filtering;
- eager rendering versus virtualization;
- optimistic updates versus confirmed writes.`,
  ),
  guide(
    "rest-api-design",
    "REST API design",
    "Resource-oriented contracts, validation, idempotency, and errors.",
    "backend",
    ["api", "rest", "validation"],
    `# REST API design

## Contract

Model stable resources, use HTTP methods consistently, validate at the
boundary, and return structured errors clients can act on.

## Reliability

Make safe retries explicit. Use idempotency keys for retryable creation when
duplicate side effects would be harmful.`,
  ),
  guide(
    "authentication-authorization",
    "Authentication and authorization",
    "Separate identity verification from permission decisions.",
    "backend",
    ["authentication", "authorization", "security"],
    `# Authentication and authorization

## Separation

Authentication establishes who the caller is. Authorization decides whether
that identity may perform a specific action on a specific resource.

## Guard

Enforce authorization server-side at every protected boundary and default to
deny. Do not rely on hidden UI controls.`,
  ),
  official(
    "database-transactions",
    "Database transactions",
    "Atomicity, isolation, and retry-aware application design.",
    "backend",
    ["database", "transactions", "postgresql"],
    "PostgreSQL",
    "https://www.postgresql.org/docs/current/tutorial-transactions.html",
    `# Transactions

## Atomic unit

A transaction groups operations so they commit together or roll back together.
Isolation controls which concurrent effects are visible.

## Application behavior

Keep transactions short, enforce invariants in the database, and be prepared to
retry failures caused by concurrency control.`,
  ),
  guide(
    "database-indexes",
    "Database indexes",
    "Trade write cost and storage for faster targeted reads.",
    "backend",
    ["database", "indexes", "performance"],
    `# Database indexes

## Purpose

An index provides an alternate access path so the database can avoid scanning
every row for supported predicates or ordering.

## Trade-off

Indexes consume storage and add work to writes. Choose them from real query
patterns and confirm plans rather than indexing every column.`,
  ),
  guide(
    "server-caching",
    "Server-side caching",
    "Cache keys, freshness, invalidation, and stampede protection.",
    "backend",
    ["backend", "caching", "reliability"],
    `# Server-side caching

## Correctness

The key must contain every input that changes the result. Define freshness and
invalidation before optimizing hit rate.

## Failure modes

Protect against stampedes with request coalescing or staggered expiry. Decide
whether stale data or an error is safer when the cache is unavailable.`,
  ),
  guide(
    "message-queues",
    "Message queues",
    "Decouple work while designing explicitly for retries and ordering.",
    "backend",
    ["queues", "distributed-systems", "reliability"],
    `# Message queues

## Why use one

A queue absorbs bursts and decouples producers from slower consumers.

## Delivery

Assume retries and design consumers to be idempotent. Ordering is usually
limited to a queue, partition, or key; do not assume a global order unless the
system guarantees it.`,
  ),
  guide(
    "backend-observability",
    "Backend observability",
    "Correlate logs, metrics, and traces around user-visible outcomes.",
    "backend",
    ["observability", "backend", "reliability"],
    `# Observability

## Signals

Metrics show trends, logs explain discrete events, and traces connect work
across service boundaries.

## Interview answer

Start from a user-visible objective, attach a request or trace identifier, avoid
logging secrets, and alert on symptoms rather than every internal fluctuation.`,
  ),
  pattern(
    "array-traversal",
    "Array traversal",
    "Use one pass when each element contributes to a maintained invariant.",
    ["arrays", "iteration", "complexity"],
    `# Array traversal

## Recognition

You need an aggregate, best-so-far value, transformation, or validation over a
sequence.

## Invariant

After processing index \`i\`, the maintained state correctly summarizes the
prefix through \`i\`.

## Complexity

One pass is **O(n)** time. Extra space depends on the maintained state.`,
  ),
  pattern(
    "hash-map-lookup",
    "Hash map lookup",
    "Trade additional space for average constant-time membership or counts.",
    ["hash-map", "lookup", "counting"],
    `# Hash map lookup

## Recognition

The problem repeatedly asks whether a value was seen, how often it occurred, or
which earlier item complements the current item.

## Invariant

Before processing the current value, the map represents exactly the relevant
processed prefix.

## Complexity

Expected **O(n)** time and **O(n)** space.`,
  ),
  pattern(
    "two-pointers",
    "Two pointers",
    "Exploit ordering or a shrinking search space with coordinated indices.",
    ["two-pointers", "arrays", "strings"],
    `# Two pointers

## Recognition

The input is ordered, you compare values from both ends, or you compact a
sequence in place.

## Invariant

Everything outside the active pointer range has already been classified or
placed correctly.

## Complexity

Each pointer moves monotonically, giving **O(n)** time and usually **O(1)**
extra space.`,
  ),
  pattern(
    "sliding-window",
    "Sliding window",
    "Maintain a valid contiguous range instead of recomputing each range.",
    ["sliding-window", "arrays", "strings"],
    `# Sliding window

## Recognition

The question asks for a longest, shortest, or counted contiguous subarray or
substring under a monotonic constraint.

## Invariant

The current window is valid after the left pointer finishes moving.

## Complexity

Both boundaries move forward at most \`n\` times: **O(n)** time.`,
  ),
  pattern(
    "string-frequency",
    "String frequency",
    "Normalize characters and compare counts rather than permutations.",
    ["strings", "hash-map", "frequency"],
    `# String frequency

## Recognition

The problem asks about anagrams, duplicates, uniqueness, or character balance.

## Strategy

Define normalization first, then count with a fixed array for a small known
alphabet or a map for general characters.

## Complexity

Counting is **O(n)** time and **O(k)** space for the alphabet used.`,
  ),
  pattern(
    "binary-search",
    "Binary search",
    "Discard half of an ordered or monotonic search space each step.",
    ["binary-search", "arrays", "monotonic"],
    `# Binary search

## Recognition

The data is sorted, or a yes/no predicate changes from false to true at one
boundary.

## Invariant

If an answer exists, it remains inside the current inclusive or half-open search
interval.

## Complexity

**O(log n)** predicate evaluations and **O(1)** iterative space.`,
  ),
  pattern(
    "stack-and-queue",
    "Stack and queue",
    "Use access order to model nested work or first-in-first-out processing.",
    ["stack", "queue", "data-structures"],
    `# Stack and queue

## Stack

Last-in-first-out fits nested delimiters, undo, monotonic boundaries, and
depth-first traversal.

## Queue

First-in-first-out fits breadth-first traversal, scheduling, and streaming
buffers.

## Complexity

Use indexed queues rather than repeatedly shifting arrays when shifts are
linear.`,
  ),
  pattern(
    "complexity-analysis",
    "Time and space complexity",
    "Count growth with input size and separate auxiliary from output space.",
    ["complexity", "big-o", "communication"],
    `# Complexity analysis

## Time

Count how often each pointer, loop, recursive call, or data-structure operation
can occur as input grows. Drop constants and lower-order terms.

## Space

State whether you mean auxiliary space or total output space. Include recursion
depth and collections whose size grows with input.

## Communication

Name the dominant operation and justify the bound instead of only stating it.`,
  ),
];
