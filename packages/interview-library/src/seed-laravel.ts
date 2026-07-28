import type { LibraryItemInput } from "@omnitech/interview-contracts";

const verifiedAt = "2026-07-27";

function laravel(
  slug: string,
  title: string,
  summary: string,
  tags: string[],
  path: string,
  body: string,
): LibraryItemInput {
  return {
    slug,
    title,
    summary,
    body,
    contentType: "official-reference",
    collection: "laravel",
    tags: ["laravel", "laravel-13", ...tags],
    source: {
      publisher: "Laravel",
      canonicalUrl: `https://laravel.com/docs/13.x/${path}`,
      official: true,
      version: "13.x",
      lastVerifiedAt: verifiedAt,
    },
  };
}

export const laravelLibrarySeed: LibraryItemInput[] = [
  laravel(
    "laravel-13",
    "Laravel 13",
    "The framework structure and conventions that matter in backend interviews.",
    ["framework", "architecture"],
    "lifecycle",
    `# Laravel 13

## Request lifecycle

The public entry point creates the application, the HTTP kernel runs bootstrappers
and middleware, service providers register and boot services, and the router
dispatches the request to a route or controller.

## Design approach

Laravel favors convention, dependency injection, expressive facades, and small
framework services. Keep domain rules out of controllers and ORM models when
they need an independent lifecycle.`,
  ),
  laravel(
    "laravel-service-container",
    "Laravel Service Container",
    "Resolve dependencies and bind interfaces to implementations.",
    ["service-container", "dependency-injection"],
    "container",
    `# Service Container

## Automatic injection

Concrete classes can usually be resolved without configuration. Type-hint a
dependency in a controller, listener, middleware, or job constructor and the
container supplies it.

## Explicit bindings

Bind an interface to an implementation when the container cannot infer the
choice. Use singleton or scoped lifetimes only when shared identity is required.

## Interview caveat

Avoid resolving dependencies through the container inside domain code. Explicit
constructor injection keeps dependencies visible and testable.`,
  ),
  laravel(
    "laravel-service-providers",
    "Laravel Service Providers",
    "Register bindings, listeners, routes, and application boot logic.",
    ["service-providers", "bootstrapping"],
    "providers",
    `# Service Providers

## register

Use \`register()\` for container bindings. Do not depend on services provided by
other providers while registration is still in progress.

## boot

Use \`boot()\` after all providers have registered for routes, observers,
macros, and other application startup behavior.

## Interview distinction

The container resolves objects; providers configure the application and teach
the container how selected objects should be built.`,
  ),
  laravel(
    "laravel-routing",
    "Laravel Routing",
    "Map HTTP requests to actions with parameters, names, groups, and binding.",
    ["routing", "http"],
    "routing",
    `# Routing

## Core API

\`Route::get()\`, \`post()\`, and other verb methods register handlers. Name
routes for URL generation and group shared middleware, prefixes, or domains.

## Model binding

Implicit binding resolves a type-hinted Eloquent model from a route parameter.
Use scoped binding when a child model must belong to its parent.

## Interview caveat

Routes select an application action. Authentication, validation, authorization,
and business rules still belong at their appropriate boundaries.`,
  ),
  laravel(
    "laravel-middleware",
    "Laravel Middleware",
    "Inspect or transform requests and responses around application handling.",
    ["middleware", "http", "security"],
    "middleware",
    `# Middleware

## Pipeline

Middleware receives a request, may return early, or passes it to the next layer.
Code after \`$next($request)\` can inspect or modify the response.

## Use it for

Authentication, throttling, CORS, request IDs, and cross-cutting policy belong
in middleware. Domain-specific decisions usually do not.

## Ordering

Middleware order is observable. Put prerequisites before consumers and keep
terminable or response-transforming middleware deliberate.`,
  ),
  laravel(
    "laravel-validation",
    "Laravel Validation",
    "Validate and authorize incoming data before it reaches domain logic.",
    ["validation", "requests", "security"],
    "validation",
    `# Validation

## Form requests

A Form Request groups authorization and validation rules. Valid input is read
with \`validated()\` or \`safe()\`, preventing accidental mass use of unchecked
fields.

## Failure behavior

Traditional requests redirect with errors; JSON requests receive a 422 response
with structured validation errors.

## Interview caveat

Input validation checks shape and boundary rules. Domain invariants still need
enforcement in the domain or application layer.`,
  ),
  laravel(
    "laravel-eloquent",
    "Eloquent ORM",
    "Map database records to models and compose expressive queries.",
    ["eloquent", "orm", "database"],
    "eloquent",
    `# Eloquent ORM

## Querying

Build queries lazily and execute them with terminal operations such as
\`get()\`, \`first()\`, or \`paginate()\`. Select only needed columns for large
reads.

## Writes

Protect mass assignment with \`$fillable\` or \`$guarded\`. Use transactions
when multiple writes form one atomic operation.

## Interview caveat

Watch for N+1 queries, unbounded result sets, model-event side effects, and
business rules hidden in persistence callbacks.`,
  ),
  laravel(
    "laravel-eloquent-relationships",
    "Eloquent Relationships",
    "Model one-to-one, one-to-many, many-to-many, and polymorphic associations.",
    ["eloquent", "relationships", "database"],
    "eloquent-relationships",
    `# Eloquent Relationships

## Loading

Lazy loading fetches a relationship when accessed. Eager loading with
\`with()\` fetches required relationships in bounded queries and prevents the
common N+1 problem.

## Querying

Use \`whereHas()\` for relationship constraints, \`withCount()\` for aggregate
counts, and constrained eager loading when only a subset is needed.

## Interview caveat

Choose database constraints and indexes to preserve integrity; ORM
relationships alone do not enforce it.`,
  ),
  laravel(
    "laravel-query-builder",
    "Laravel Query Builder",
    "Build parameterized SQL queries without full Eloquent model hydration.",
    ["query-builder", "database", "sql"],
    "queries",
    `# Query Builder

## Use it for

Use \`DB::table()\` for joins, aggregates, bulk operations, or reads that do not
need model behavior. Values are bound as parameters by default.

## Safety

Bindings cannot protect identifiers such as column names or sort directions.
Allowlist any identifier influenced by request input.

## Performance

Inspect generated SQL and query plans, add indexes for access patterns, and use
\`chunkById()\` or cursors for large datasets.`,
  ),
  laravel(
    "laravel-collections",
    "Laravel Collections",
    "Transform in-memory sequences with a fluent immutable-style API.",
    ["collections", "data-transformation"],
    "collections",
    `# Collections

## Common operations

\`map()\` transforms, \`filter()\` selects, \`reduce()\` folds, \`groupBy()\`
partitions, and \`keyBy()\` creates a lookup.

## Lazy collections

\`LazyCollection\` can process streams and large sources with bounded memory,
provided the upstream source is also lazy.

## Interview caveat

Collection operations run in PHP. Apply database filtering, grouping, and
pagination before hydration when the database can do the work efficiently.`,
  ),
  laravel(
    "laravel-queues",
    "Laravel Queues",
    "Move slow or retryable work to durable background jobs.",
    ["queues", "jobs", "reliability"],
    "queues",
    `# Queues

## Job design

Make jobs idempotent, pass stable identifiers instead of large object graphs,
and set explicit timeout, retry, and backoff policies.

## Dispatch timing

Use after-commit dispatch when a worker must not observe database state before
its transaction commits.

## Failure handling

Monitor failed jobs, cap retries, separate permanent from transient failures,
and use unique jobs or domain idempotency keys to prevent duplicate effects.`,
  ),
  laravel(
    "laravel-cache",
    "Laravel Cache",
    "Store reusable values with explicit keys, lifetimes, and invalidation.",
    ["cache", "performance", "reliability"],
    "cache",
    `# Cache

## Core pattern

\`Cache::remember($key, $ttl, $callback)\` reads through the cache. Include every
input that changes the result in the key.

## Invalidation

Prefer short, explicit lifetimes or event-driven invalidation. Tags can group
related entries when the selected driver supports them.

## Concurrency

Use atomic locks for distributed mutual exclusion and design the underlying
operation to remain safe if a lock expires or a worker crashes.`,
  ),
  laravel(
    "laravel-events",
    "Laravel Events",
    "Decouple domain occurrences from synchronous or queued reactions.",
    ["events", "listeners", "architecture"],
    "events",
    `# Events

## Model

An event states that something happened; listeners perform reactions. Queue a
listener when it is slow or can complete after the request.

## Trade-off

Events reduce direct coupling but make control flow less visible. Name events
in domain language and keep critical transactional work explicit.

## Reliability

For externally visible side effects, combine after-commit dispatch,
idempotency, retries, and an outbox when stronger delivery guarantees matter.`,
  ),
  laravel(
    "laravel-testing",
    "Laravel Testing",
    "Test HTTP behavior, services, databases, queues, events, and jobs.",
    ["testing", "quality"],
    "testing",
    `# Testing

## Test layers

Feature tests cover routes, middleware, validation, authorization, and
persistence. Unit tests cover isolated domain behavior without booting the
framework.

## Fakes

\`Queue::fake()\`, \`Event::fake()\`, \`Mail::fake()\`, and storage fakes verify
boundary interactions without performing external work.

## Interview caveat

Do not fake the behavior under test. Assert observable outcomes and keep a
smaller set of integration tests for real database and provider boundaries.`,
  ),
];
