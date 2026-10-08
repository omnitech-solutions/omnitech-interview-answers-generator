import type { LibraryItemInput } from "@omnitech/interview-contracts";

// [DOMAIN] The full-stack TypeScript estate a product team runs: Next.js and
// React at the edge, Node and NestJS services behind it, PostgreSQL (and the
// MongoDB it is moving away from), the build and test tooling, and the
// delivery practices around them. Each entry is a spoken-length reference: the
// idea, the trade-off, and an example in the shared insurance-quoting domain.
function stack(
  slug: string,
  title: string,
  summary: string,
  collection: string,
  tags: string[],
  body: string,
  contentType: LibraryItemInput["contentType"] = "cheat-sheet",
): LibraryItemInput {
  return { slug, title, summary, body, contentType, collection, tags };
}

export const webStackLibrarySeed: LibraryItemInput[] = [
  // ---- Next.js -------------------------------------------------------------
  stack(
    "nextjs-rendering-strategies",
    "Next.js Rendering Strategies",
    "Static, server, incremental and client rendering, and how to choose per route.",
    "nextjs",
    ["nextjs", "react", "typescript", "rendering", "ssr", "ssg", "isr"],
    `# Next.js Rendering Strategies

## The four options

- Static generation (SSG): HTML is built once at build time. Fastest and
  cheapest to serve; right for content that is the same for everyone.
- Incremental static regeneration (ISR): a static page that is rebuilt in the
  background after a revalidation window or an on-demand revalidation call.
- Server rendering (SSR): HTML is produced per request. Right when the page
  depends on the request (cookies, headers, per-user data) and must be fresh.
- Client rendering (CSR): the browser fetches and renders. Right for highly
  interactive, private views where SEO and first paint matter less.

## Usage example

A commercial insurance site: the marketing and coverage-explainer pages are
static; the product catalogue with carrier appetite is ISR, revalidated when
underwriting rules change; the quote summary is server rendered because it
depends on the signed-in broker and the live premium; the quote form itself is
a client component.

## How to choose

Ask who the data belongs to and how fresh it must be. Shared and slow-changing
is static or ISR. Per-request and fresh is server rendered. Interaction-heavy is
client rendered. The choice is per route (and per fetch), not per application.

## Interview caveat

Rendering on the server does not remove the client cost: the page still
hydrates. Measure both time to first byte and time to interactive.`,
    "concept-guide",
  ),
  stack(
    "nextjs-app-router",
    "Next.js App Router and Server Components",
    "Layouts, server and client components, and where the boundary belongs.",
    "nextjs",
    ["nextjs", "react", "typescript", "app-router", "server-components"],
    `# Next.js App Router and Server Components

## Model

The app directory maps folders to routes. Special files give each segment a
layout, a page, a loading state, an error boundary and a not-found view.
Layouts persist across navigation and do not re-render.

## Server and client components

Components are server components by default: they run only on the server, can
read data and secrets directly, and ship no JavaScript. A file marked
"use client" becomes a client component: it can hold state, use effects and
handle events. Server components can render client components and pass them
serialisable props; the reverse works only through children.

## Usage example

A quote page: the server component loads the quote, the carrier responses and
the policy documents, and renders the summary. Only the premium comparison
table with its sort and filter controls is a client component, so the bundle
carries that table and nothing else.

## Where to put the boundary

Push "use client" as far down the tree as possible. A client boundary high in
the tree turns everything under it into client code.

## Interview caveat

Server Actions are public endpoints: validate input and check authorisation in
every action, exactly as for an API route.`,
    "concept-guide",
  ),
  stack(
    "nextjs-code-splitting",
    "Next.js Automatic Code Splitting",
    "What the framework splits for you, and what you defer by hand.",
    "nextjs",
    [
      "nextjs",
      "react",
      "typescript",
      "code-splitting",
      "performance",
      "bundling",
    ],
    `# Next.js Automatic Code Splitting

## What automatic means

Every route becomes its own JavaScript chunk at build time, so visiting one
page does not download the code for the others. Code shared by several routes
(React, the framework runtime, common components) is extracted into shared
chunks that are downloaded once and cached.

## What you still do by hand

Heavy code that a page does not need at first paint is loaded on demand with a
dynamic import (next/dynamic, or React.lazy with Suspense): a chart, a rich
editor, a modal, a PDF viewer. Server components add nothing to the bundle at
all, which is the cheapest split there is.

## Usage example

A broker dashboard loads the policy list immediately. The premium trend chart
and the coverage comparison modal are dynamic imports, so their libraries are
fetched only when the broker opens them.

## Why it matters

A smaller first load means a faster time to interactive, and the cost of each
page stays roughly flat as the application grows.

## Interview caveat

Splitting too finely costs extra requests and waterfalls. Split on routes and
on genuinely heavy, deferred features; check the result with the bundle
analyser rather than guessing.`,
  ),
  stack(
    "nextjs-data-fetching-and-caching",
    "Next.js Data Fetching and Caching",
    "Server-side fetching, revalidation, and the cache layers that surprise people.",
    "nextjs",
    [
      "nextjs",
      "react",
      "typescript",
      "caching",
      "data-fetching",
      "revalidation",
    ],
    `# Next.js Data Fetching and Caching

## Fetching

In the App Router, data is fetched in server components with async and await.
Independent requests should start together (Promise.all) rather than one after
another, and slow sections should stream behind a Suspense boundary.

## Cache layers

- Request memoisation: identical fetches in one render are de-duplicated.
- Data cache: a fetch result stored across requests until it is revalidated.
- Full route cache: the rendered output of a static route.
- Router cache: the client's in-memory cache of visited segments.

## Revalidation

Time-based (a revalidate window) or on demand (revalidate a path or a tag after
a write). Opting a fetch out of the cache makes the route dynamic.

## Usage example

Carrier appetite rules are fetched with a tag and cached; when an underwriter
publishes a change, the write revalidates that tag. A broker's quote and its
premium are never cached: they are per user and must be current.

## Interview caveat

The defaults have changed between major versions. State the version you mean,
and be explicit in code about what is cached and for how long.`,
  ),
  stack(
    "nextjs-routing-middleware-deployment",
    "Next.js Routing, Middleware and Deployment",
    "Dynamic routes, route handlers, middleware, and deployment targets.",
    "nextjs",
    [
      "nextjs",
      "react",
      "typescript",
      "routing",
      "middleware",
      "deployment",
      "serverless",
    ],
    `# Next.js Routing, Middleware and Deployment

## Routing

Folders are routes; a segment in square brackets is dynamic. Route handlers
(route.ts) are the framework's API endpoints. Route groups organise files
without changing the URL; parallel and intercepting routes cover modals and
split views.

## Middleware

Runs before a request is matched: redirects, rewrites, locale and
authentication gates. It runs on a restricted runtime, so keep it small and do
real authorisation again where the data is read.

## Deployment targets

- A Node server (next start), usually in a container using the standalone
  output, which copies only the files the server needs.
- Serverless or edge functions on a platform that adapts the build.
- A static export when no server features are used.

The old "target: serverless" option in next.config.js was removed; current
versions use the output setting ("standalone" or "export") and the platform's
adapter instead.

## Usage example

A quoting portal runs as a standalone container behind a load balancer.
Middleware sends an unauthenticated broker to sign-in; the policy document
download is a route handler that checks the broker owns the policy.

## Interview caveat

Serverless trades idle cost for cold starts and connection limits: a database
needs a pooler in front of it.`,
  ),

  // ---- React ecosystem ------------------------------------------------------
  stack(
    "redux-toolkit-essentials",
    "Redux and Redux Toolkit Essentials",
    "One store, pure reducers, and when global state is worth its cost.",
    "frontend",
    ["redux", "redux-toolkit", "react", "typescript", "state-management"],
    `# Redux and Redux Toolkit Essentials

## Model

One store holds application state. Components dispatch actions; pure reducers
compute the next state; selectors read from it. Data flows one way, so every
change is traceable and replayable.

## Redux Toolkit

The standard way to write Redux: createSlice generates actions and reducers
(Immer lets reducers be written as mutations), createAsyncThunk handles async
lifecycles, and RTK Query provides fetching, caching and invalidation.

## Usage example

A multi-step quote form keeps the applicant, the coverage choices and the
carrier responses in a quote slice. Each step dispatches an update; a selector
derives the total premium, so no component recomputes it.

## When to use it

Use it for state that many distant components read and change, that needs
time-travel debugging, or that has complex transitions. Keep server data in a
query cache and local UI state in the component.

## Interview caveat

Putting everything in the store is the common mistake: it makes every change
global and every component a subscriber. Select narrowly and memoise derived
data.`,
  ),
  stack(
    "micro-frontends",
    "Micro-frontends",
    "Independently deployed front-end slices, and the price of that independence.",
    "frontend",
    [
      "micro-frontends",
      "module-federation",
      "react",
      "typescript",
      "architecture",
    ],
    `# Micro-frontends

## What they are

A front end composed from slices that separate teams build, test and deploy on
their own. Composition happens at build time (packages), at run time in the
browser (Module Federation, import maps, web components) or at the edge or
server (fragments stitched into a page).

## What they buy

Team autonomy and independent release cadence. A slice can be upgraded or
rewritten without a coordinated release of the whole site.

## What they cost

Duplicate dependencies and larger payloads unless shared carefully, a
fragmented user experience without a shared design system, cross-slice
contracts to version, and harder end-to-end testing.

## Usage example

An insurance platform splits by business capability: quoting, checkout and
payments, and policy documents. A thin shell owns navigation, authentication
and the design system; each slice owns its routes. The quote slice hands
checkout a quote id, never its internal state.

## Rules that keep it sane

Split by domain, not by technical layer. Share a design system and a small set
of singleton libraries. Communicate through URLs and explicit events, not
shared stores.

## Interview caveat

They solve an organisational scaling problem. With one team, a modular
monolith front end is simpler and faster.`,
    "concept-guide",
  ),

  // ---- TypeScript and Node ---------------------------------------------------
  stack(
    "typescript-type-system-essentials",
    "TypeScript Type System Essentials",
    "Structural typing, narrowing, generics, and types that make bad states unrepresentable.",
    "typescript",
    ["typescript", "types", "generics", "narrowing"],
    `# TypeScript Type System Essentials

## Core ideas

- Structural typing: compatibility is by shape, not by name.
- Narrowing: typeof, in, equality and discriminant checks refine a union.
- unknown over any: unknown forces a check before use; any switches checking off.
- Generics: write a function or type once and keep the relationship between
  its inputs and outputs.
- Utility types: Partial, Pick, Omit, Record, ReturnType, Awaited.

## Discriminated unions

Model states as a union with a shared literal tag. The compiler then makes
every switch handle every state, and a never check catches a state added later.

## Usage example

A quote is one of: draft, awaiting carrier, quoted with a premium, or declined
with a reason. As a discriminated union on status, code cannot read a premium
from a declined quote, and adding a "referred to underwriting" state fails to
compile until every consumer handles it.

## At the boundary

Types vanish at run time. Validate anything from outside (HTTP, a queue, a
carrier API) with a schema library and derive the static type from the schema.

## Interview caveat

Type assertions (as) and non-null assertions silence the compiler; each one is
a claim you must be able to defend.`,
  ),
  stack(
    "nodejs-event-loop-and-concurrency",
    "Node.js Event Loop and Concurrency",
    "One thread for JavaScript, a loop for I/O, and what blocks it.",
    "nodejs",
    ["nodejs", "typescript", "event-loop", "async", "concurrency"],
    `# Node.js Event Loop and Concurrency

## Model

JavaScript runs on one thread. I/O is handed to the operating system or the
libuv thread pool, and callbacks run when results arrive. The loop passes
through phases (timers, pending callbacks, poll, check, close); microtasks
(promise callbacks) run between callbacks, before the loop moves on.

## What this means

Node handles many concurrent connections cheaply as long as work is I/O bound.
CPU-heavy work on the main thread blocks every request.

## Usage example

A quoting service calls five carrier APIs. It starts all five at once and
awaits them together with a deadline, so the response takes as long as the
slowest carrier, not the sum. Generating a large policy PDF is moved to a
worker thread or a queue so it never stalls the loop.

## Tools

- Promise.all for all-or-nothing, Promise.allSettled when partial results are
  acceptable.
- AbortController and timeouts for every outbound call.
- Worker threads or a job queue for CPU work; the cluster module or several
  containers to use more than one core.

## Interview caveat

An unhandled promise rejection or a long synchronous loop is a production
incident. Watch event-loop lag as a metric.`,
    "concept-guide",
  ),
  stack(
    "nodejs-streams-and-backpressure",
    "Node.js Streams and Backpressure",
    "Process data in pieces without holding it all in memory.",
    "nodejs",
    ["nodejs", "typescript", "streams", "backpressure", "performance"],
    `# Node.js Streams and Backpressure

## Kinds

Readable, Writable, Duplex and Transform. Data moves in chunks, so memory use
stays flat whatever the size of the input.

## Backpressure

A fast producer must slow down for a slow consumer. pipeline (from
stream/promises) connects streams, propagates backpressure and errors, and
cleans up on failure. Readable streams are also async iterables.

## Usage example

Exporting every policy for a brokerage as CSV: rows are read from the database
with a cursor, transformed, and piped to the HTTP response. A hundred thousand
policies use the same memory as a hundred.

## Interview caveat

Calling pipe without handling errors leaks file handles and sockets. Prefer
pipeline.`,
  ),
  stack(
    "nodejs-api-design-and-errors",
    "Node.js API Design, Validation and Errors",
    "Validated input, typed errors, and a consistent failure contract.",
    "nodejs",
    ["nodejs", "typescript", "api", "validation", "error-handling"],
    `# Node.js API Design, Validation and Errors

## Layers

Transport (HTTP, GraphQL, queue) parses and validates input, calls an
application service, and maps the result to a response. Business rules live in
the service, not in the handler.

## Errors

Separate operational errors (invalid input, not found, a dependency timed out)
from programmer errors (a bug). Operational errors are typed, expected and
mapped to a status and a stable code. Programmer errors are logged with
context and return a generic failure.

## Usage example

Creating a quote: the handler validates the applicant and coverage with a
schema; the service returns a quote or a typed "carrier unavailable" result;
the handler maps that to a 503 with a code the client can act on. A stack
trace never reaches the broker.

## Checklist

- Validate at the edge and derive types from the schema.
- Idempotency keys for writes a client may retry.
- Pagination, filtering and consistent error bodies.
- A request id on every log line and response.

## Interview caveat

Throwing strings, or catching and ignoring, loses the cause. Preserve it with
the error's cause.`,
  ),

  // ---- NestJS ----------------------------------------------------------------
  stack(
    "nestjs-architecture",
    "NestJS Architecture: Modules, Providers and Dependency Injection",
    "How a NestJS service is composed, and where business rules belong.",
    "nestjs",
    ["nestjs", "nodejs", "typescript", "dependency-injection", "modules"],
    `# NestJS Architecture: Modules, Providers and Dependency Injection

## Building blocks

- Module: a unit of composition that declares its controllers and providers
  and exports what other modules may use.
- Controller: maps transport requests to application calls.
- Provider: an injectable class (service, repository, client) the container
  creates and wires by constructor type.

Providers are singletons by default; request and transient scopes exist but
cost performance and spread to everything that depends on them.

## Usage example

A quoting service has a QuotesModule (controller, quote service), a
CarriersModule that exports a carrier gateway behind an interface, and a
PolicyDocumentsModule. Tests replace the carrier gateway with a fake by
overriding one provider.

## Where rules live

Nest owns transport, validation, authentication, composition and
instrumentation. Workflows, business rules and state transitions live in
plain classes with explicit inputs and outputs, so they can be tested without
the framework.

## Interview caveat

Treat NestJS as a delivery and composition framework, not as the architecture.
Business logic in controllers and very large injectable services are the
usual failure modes.`,
    "concept-guide",
  ),
  stack(
    "nestjs-request-pipeline",
    "NestJS Request Pipeline",
    "Middleware, guards, interceptors, pipes and exception filters, in order.",
    "nestjs",
    [
      "nestjs",
      "nodejs",
      "typescript",
      "guards",
      "interceptors",
      "pipes",
      "middleware",
    ],
    `# NestJS Request Pipeline

## Order

1. Middleware: raw request work (request id, logging).
2. Guards: may this request proceed? Authentication and authorisation.
3. Interceptors (before): wrap the handler; timing, caching, mapping.
4. Pipes: validate and transform each argument.
5. Handler.
6. Interceptors (after): transform the result.
7. Exception filters: turn a thrown error into a response.

Each can be bound globally, per controller or per route.

## Usage example

Binding a policy: a guard checks the broker may act for that customer; a
validation pipe checks the bind request against its DTO; an interceptor
records latency per carrier; an exception filter maps "quote expired" to a
409 with a stable code.

## Interview caveat

Guards decide access and nothing else. Putting validation or business rules in
a guard, or authorisation in an interceptor, makes the order of execution part
of your security model.`,
  ),
  stack(
    "nestjs-microservices",
    "NestJS Microservices and Messaging",
    "Transports, request-response versus events, and delivery guarantees.",
    "nestjs",
    ["nestjs", "nodejs", "typescript", "microservices", "messaging", "events"],
    `# NestJS Microservices and Messaging

## Transports

The microservices package speaks TCP, Redis, NATS, RabbitMQ, Kafka, MQTT and
gRPC behind one programming model. A hybrid application can serve HTTP and
consume messages in the same process.

## Two styles

- Message pattern: request and response; the caller waits for a reply.
- Event pattern: fire and continue; zero or many consumers react.

## Usage example

When a quote is bound, the quoting service publishes "policy bound". The
documents service generates the policy documents, and the payments service
starts collection of the premium. Neither is called directly, so a slow
document render does not fail the bind.

## Making it reliable

Assume at-least-once delivery: consumers must be idempotent. Publish events in
the same transaction as the state change with an outbox table. Use dead-letter
queues, bounded retries with backoff, and a correlation id through every hop.

## Interview caveat

A chain of synchronous calls between services is a distributed monolith: every
hop multiplies latency and failure. Prefer events across boundaries.`,
    "concept-guide",
  ),
  stack(
    "nestjs-testing",
    "Testing NestJS Services",
    "Unit tests on plain classes, module tests with overrides, and end-to-end.",
    "nestjs",
    ["nestjs", "nodejs", "typescript", "testing", "jest"],
    `# Testing NestJS Services

## Levels

- Unit: construct the class directly with fakes. No container needed.
- Module: build a testing module and override providers (a repository, an
  outbound client) to test wiring, guards and pipes.
- End-to-end: start the application in the test process and call it over
  HTTP against a real database.

## Usage example

The premium calculation is tested as a pure function with table-driven cases.
The quote controller is tested through a testing module with the carrier
gateway overridden by a fake that returns a decline, a timeout and a quote.
One end-to-end test walks quote, bind and policy issue against PostgreSQL.

## Interview caveat

Mocking everything proves only that the mocks agree with themselves. Keep
fakes at the true boundary (the network) and use a real database for
persistence tests.`,
  ),

  // ---- Data -------------------------------------------------------------------
  stack(
    "postgresql-indexing-and-query-plans",
    "PostgreSQL Indexing and Query Plans",
    "Which index, why the planner ignored it, and how to read a plan.",
    "postgresql",
    ["postgresql", "sql", "indexes", "query-plan", "performance"],
    `# PostgreSQL Indexing and Query Plans

## Index types

- B-tree: the default; equality, ranges and ordering.
- GIN: arrays, JSONB and full-text search.
- GiST and BRIN: ranges and geometry; very large, naturally ordered tables.
- Partial index: only the rows that match a condition.
- Composite and covering (INCLUDE) indexes: answer a query from the index.

## Reading a plan

EXPLAIN (ANALYZE, BUFFERS) shows the plan with real timings. Look for
sequential scans on large tables, row estimates far from actual rows, and
sorts or hash joins spilling to disk.

## Usage example

Listing a broker's open quotes, newest first: a composite index on broker id
and created-at, partial on status "open", serves the filter and the ordering
with no sort. A JSONB column of carrier responses gets a GIN index only for
the key actually queried.

## Rules

Column order matters: equality columns first, then the range or sort column.
Every index slows writes and needs maintenance; remove unused ones.

## Interview caveat

A function on an indexed column, a type mismatch or stale statistics will
make the planner skip an index that looks right.`,
  ),
  stack(
    "postgresql-transactions-and-concurrency",
    "PostgreSQL Transactions, Isolation and Locking",
    "MVCC, isolation levels, and avoiding lost updates.",
    "postgresql",
    [
      "postgresql",
      "sql",
      "transactions",
      "isolation",
      "locking",
      "concurrency",
    ],
    `# PostgreSQL Transactions, Isolation and Locking

## MVCC

Readers do not block writers: each transaction sees a snapshot. The default
level, read committed, takes a new snapshot per statement. Repeatable read
keeps one snapshot for the transaction; serializable also detects conflicts
and may ask you to retry.

## Avoiding lost updates

- Optimistic: a version column checked in the UPDATE.
- Pessimistic: SELECT ... FOR UPDATE to lock the row first.
- Atomic: express the change as one statement where possible.
- SKIP LOCKED: several workers take different rows from a queue table.

## Usage example

Two brokers bind the same quote at once. The bind runs in a transaction that
locks the quote row, checks it is still open, creates the policy and marks the
quote bound. The second request finds it bound and returns a conflict, so one
premium is collected, not two.

## Interview caveat

Long transactions hold back vacuum and take locks for their whole length.
Keep them short and never wait on a network call inside one.`,
    "concept-guide",
  ),
  stack(
    "postgresql-schema-design-and-migrations",
    "PostgreSQL Schema Design and Safe Migrations",
    "Constraints as guarantees, JSONB where it fits, and changes without downtime.",
    "postgresql",
    ["postgresql", "sql", "schema", "migrations", "jsonb", "constraints"],
    `# PostgreSQL Schema Design and Safe Migrations

## Design

Let the database hold the invariants: primary and foreign keys, NOT NULL,
unique and check constraints. Use JSONB for genuinely variable attributes and
real columns for anything you filter, join or constrain.

## Migrations without downtime

Expand, migrate, contract:

1. Add the new column or table, nullable, with no rewrite.
2. Write to both; backfill in batches.
3. Switch reads; then remove the old shape.

Create indexes concurrently, add constraints as NOT VALID and validate
afterwards, and set a lock timeout so a migration fails fast instead of
queueing every request behind it.

## Usage example

Policies gain a renewal date. The column is added nullable, backfilled from
the policy term in batches, then made required. Carrier-specific coverage
fields stay in a JSONB column because each carrier's form differs.

## Interview caveat

A migration that rewrites a large table or takes an exclusive lock is an
outage. Test it against production-sized data.`,
  ),
  stack(
    "mongodb-essentials",
    "MongoDB Essentials",
    "Document modelling, indexes, the aggregation pipeline, and consistency.",
    "mongodb",
    ["mongodb", "nosql", "documents", "aggregation", "indexes"],
    `# MongoDB Essentials

## Model

Data is stored as documents in collections. Model for the queries: embed data
that is read together and bounded in size; reference data that is shared,
large or changes independently.

## Tools

- Indexes: single, compound, multikey, partial, text and TTL.
- Aggregation pipeline: match, group, project, lookup and sort stages.
- Replica sets for availability; sharding for horizontal scale.
- Multi-document transactions exist, at a cost; write and read concerns set
  how durable and how current an operation is.

## Usage example

A quote document embeds the applicant's answers and each carrier's response:
it is read whole and never grows without bound. Policies reference the
customer by id, because one customer has many policies.

## Where it fits

Document-shaped data with a flexible schema and access by key. It fits less
well when records relate to each other, need multi-record integrity, or are
queried in many ad hoc ways.

## Interview caveat

"Schemaless" means the schema lives in application code. Without validation
rules, old and new shapes pile up in the same collection.`,
  ),
  stack(
    "mongodb-to-postgresql-migration",
    "Migrating from MongoDB to PostgreSQL",
    "Move one bounded context at a time, prove parity, and keep a way back.",
    "postgresql",
    ["postgresql", "mongodb", "migration", "data-consistency", "architecture"],
    `# Migrating from MongoDB to PostgreSQL

## Start with the reason

Move a domain only for a real problem: relational integrity, multi-record
consistency, reporting, transaction boundaries or queryability. Document-shaped
data that works well can stay.

## Steps

1. Choose one bounded context, not a collection.
2. Design the relational model and its invariants; do not copy collections
   table for table.
3. Put a stable application contract in front of persistence.
4. Backfill history; run domain-level parity checks.
5. Use shadow reads or controlled comparison to build confidence.
6. Cut over gradually, behind a flag, with metrics and a rollback path.

## Usage example

Policy data moves first: policies, coverages and endorsements become related
tables with foreign keys. Quotes, with their varied carrier answers, stay as
documents for now. Reads are compared for a sample of policies each night
until the mismatch rate is zero, then traffic is switched in stages.

## Rules

Prefer one authoritative writer to indefinite dual writes. Decide who is
authoritative for each field while both stores exist.

## Interview caveat

The hard part is not copying data. It is the implicit rules the old shape
allowed, which must become explicit constraints or explicit exceptions.`,
    "concept-guide",
  ),

  // ---- Architecture ------------------------------------------------------------
  stack(
    "microservices-and-service-boundaries",
    "Microservices and Service Boundaries",
    "When a boundary earns the distributed-systems cost, and when it does not.",
    "architecture",
    [
      "microservices",
      "architecture",
      "distributed-systems",
      "modular-monolith",
    ],
    `# Microservices and Service Boundaries

## Draw the logical boundary first

A module with a clear responsibility, its own data and an explicit contract.
Whether it runs in its own process is a second, separate decision.

## Extract a service when it gives you

- independent deployment and release cadence;
- clear ownership by one team;
- different scaling or availability needs;
- security or failure isolation;
- a complex external integration worth containing.

Do not extract because the domain is important, the codebase is large, or it
is fashionable.

## What it costs

Network failure, latency, eventual consistency, versioned contracts,
distributed tracing, and more to deploy and operate.

## Usage example

Policy document generation is extracted: it is CPU heavy, scales separately
and must not slow a broker's quote. Pricing rules stay a module inside the quoting service: they
change with quoting and need its transaction.

## Data

Each service owns its data. Others get it through an API or events, never by
reading its tables.

## Interview caveat

Services that must be deployed together, or that call each other
synchronously in a chain, are a distributed monolith: the costs of both and
the benefits of neither.`,
    "concept-guide",
  ),
  stack(
    "third-party-integration-resilience",
    "Third-party Integration Resilience",
    "Adapters, deadlines, retries, idempotency, circuit breakers and reconciliation.",
    "architecture",
    [
      "integrations",
      "resilience",
      "idempotency",
      "retries",
      "circuit-breaker",
      "architecture",
    ],
    `# Third-party Integration Resilience

## Assume the dependency will

Time out, return malformed data, change its schema, rate limit you, succeed
slowly, partly succeed, send duplicates, and be unavailable.

## The standard model

- Adapter boundary: the external representation stops at the adapter; inside,
  one canonical request, response, status set and error set.
- Deadlines: every outbound call has a timeout.
- Retries: bounded, with backoff and jitter, only for retry-safe operations.
- Idempotency: keys or internal de-duplication where a duplicate has a cost.
- Circuit breaker and degradation: one slow dependency must not take down the
  whole journey.
- Reconciliation: when the other side gives no transactional guarantee, a
  scheduled comparison is a feature, not an afterthought.

## Usage example

A quote fans out to several carriers. Each has its own adapter and deadline.
A carrier that times out is shown as "no response" and the broker still sees
the other premiums. Binding a policy sends an idempotency key, so a retry
after a timeout cannot issue two policies.

## Observe per partner

Latency, success and failure rate, timeouts, retries, normalisation failures
and customer impact.

## Interview caveat

The external API is not your domain model. Letting its shapes leak inward
makes every provider change a change to your core.`,
    "concept-guide",
  ),
  stack(
    "graphql-essentials",
    "GraphQL Essentials",
    "Schema, resolvers, the N+1 problem, and when REST is the better fit.",
    "architecture",
    ["graphql", "api", "typescript", "schema", "dataloader"],
    `# GraphQL Essentials

## Model

A typed schema describes what clients may ask for. Queries read, mutations
write, subscriptions push. Clients choose the fields, so one endpoint serves
many screens without new endpoints or over-fetching.

## Problems to handle

- N+1: resolving a field per parent row. Batch and cache per request with a
  data loader.
- Authorisation: enforce it in the resolvers or the domain layer, per field
  where needed, not only at the gateway.
- Abuse: depth and complexity limits, persisted queries, pagination by cursor.
- Caching: no HTTP caching by URL; cache by normalised entity on the client.

## Usage example

A quote screen asks, in one query, for the quote, its coverages, each carrier's
premium and the broker's contact details. A data loader batches the carrier
lookups, so twenty quotes cost two database queries, not forty.

## Federation

Composes several services' schemas into one graph. It joins services at the
edge; it does not replace their boundaries or their ownership of data.

## Interview caveat

For simple resource APIs, public caching or file transfer, REST is simpler.`,
  ),
  stack(
    "web-security-essentials",
    "Web Application Security Essentials",
    "The common attack classes, and the controls that belong in the design.",
    "architecture",
    ["security", "owasp", "authentication", "authorization", "web"],
    `# Web Application Security Essentials

## Common classes

- Broken access control: the most frequent serious flaw. Check ownership on
  every read and write, on the server.
- Injection: parameterised queries; never build SQL or shell from input.
- Cross-site scripting: escape output, avoid raw HTML, set a content security
  policy.
- Cross-site request forgery: same-site cookies and anti-forgery tokens.
- Server-side request forgery: allow-list outbound destinations.
- Secrets and dependencies: a secrets manager, scanning and prompt patching.

## Principles

Least privilege, validation at every trust boundary, secure defaults, audit
trails for sensitive actions, and no personal data in logs.

## Usage example

A broker requests a policy document by id. The handler checks that the broker
acts for that policy's customer before returning it; a valid session alone is
not enough. The download link is short lived and the access is recorded.

## In delivery

Threat-model new flows, run static analysis and dependency scanning in CI, and
treat a third-party integration as an attack surface.

## Interview caveat

Authentication says who you are. Authorisation says what you may touch.
Most incidents are failures of the second.`,
    "concept-guide",
  ),

  // ---- Tooling -----------------------------------------------------------------
  stack(
    "webpack-and-babel-essentials",
    "Webpack and Babel Essentials",
    "What a bundler and a compiler each do, and the levers that matter.",
    "tooling",
    ["webpack", "babel", "bundling", "tooling", "javascript", "typescript"],
    `# Webpack and Babel Essentials

## Webpack

Builds a dependency graph from entry points and emits bundles.

- Loaders transform files (TypeScript, CSS, images) into modules.
- Plugins act on the whole build (HTML, environment values, analysis).
- Code splitting: dynamic imports and split chunks for shared code.
- Tree shaking: drops unused ES module exports in production mode.
- Content hashes in file names make long-term caching safe.
- Module Federation shares modules between separately built applications.

## Babel

Compiles modern JavaScript, JSX and TypeScript syntax to what your target
browsers run. Presets bundle transforms; the env preset reads a browser list
and adds only the polyfills in use. Babel removes types; it does not check
them, so type checking runs separately.

## Usage example

A quoting application splits per route and puts the premium chart library in
its own chunk. The bundle analyser shows a date library included twice; one
alias removes two hundred kilobytes from the first load.

## Interview caveat

Faster compilers (SWC, esbuild) and bundlers (Vite, Turbopack) now cover the
same ground. The concepts carry over: graph, transform, split, hash.`,
  ),
  stack(
    "storybook-essentials",
    "Storybook Essentials",
    "Components built and reviewed in isolation, with their states written down.",
    "tooling",
    ["storybook", "react", "typescript", "design-system", "tooling"],
    `# Storybook Essentials

## What it is

A workshop that renders components outside the application. A story is one
named state of a component, written as an object of arguments (Component Story
Format). Controls let anyone change the arguments live; documentation pages
are generated from the stories and the types.

## What it is good for

- Developing and reviewing a component without running the whole application.
- A living design-system catalogue shared by designers and engineers.
- Interaction tests written as play functions, accessibility checks, and
  visual regression snapshots in CI.

## Usage example

The premium summary card has stories for: quoted, declined, referred to
underwriting, loading, and a long carrier name. A visual regression run
catches a layout break in the declined state before it reaches a broker.

## Interview caveat

Stories only cover the states someone wrote. Write the empty, error, loading
and extreme-content states first; those are the ones that break.`,
  ),

  // ---- Testing -----------------------------------------------------------------
  stack(
    "jest-and-mocha-unit-testing",
    "Unit Testing with Jest and Mocha",
    "Runners, assertions, test doubles, and tests that survive refactoring.",
    "testing",
    ["jest", "mocha", "testing", "unit-tests", "typescript", "javascript"],
    `# Unit Testing with Jest and Mocha

## The two runners

- Jest: batteries included. Runner, assertions, mocks, fake timers, coverage
  and snapshots in one, with tests isolated per file.
- Mocha: a flexible runner. You add an assertion library (Chai), test doubles
  (Sinon) and coverage (nyc or c8) yourself.

Vitest offers the Jest API on a faster, ES-module-native engine.

## Good unit tests

Test behaviour through the public interface, not implementation details. One
reason to fail per test. Arrange, act, assert. Use table-driven cases for
rules. Fake only true boundaries: the clock, the network, randomness.

## Usage example

The premium rule "apply the multi-policy discount, then tax, never below the
carrier's minimum premium" is a pure function with a table of cases, including
the boundary where the discount would go under the minimum.

## Doubles

A stub returns canned answers. A mock asserts it was called. A fake is a
working lightweight implementation. Prefer fakes; over-mocked tests pass when
the code is wrong.

## Interview caveat

Coverage shows what ran, not what was checked. Use it to find untested
branches, not as a target.`,
  ),
  stack(
    "end-to-end-test-automation",
    "End-to-end Test Automation: Cypress, Playwright, Selenium",
    "Which tool, what to automate, and how to keep the suite trustworthy.",
    "testing",
    [
      "cypress",
      "playwright",
      "selenium",
      "nightwatch",
      "browserstack",
      "e2e",
      "testing",
    ],
    `# End-to-end Test Automation: Cypress, Playwright, Selenium

## Tools

- Cypress: runs inside the browser; excellent debugging and automatic waiting;
  historically weaker with multiple tabs and origins.
- Playwright: drives Chromium, Firefox and WebKit out of process; parallel by
  default, with tracing and isolated contexts.
- Selenium WebDriver: the long-standing standard, with the widest browser and
  language support. Nightwatch is a Node framework over WebDriver.
- BrowserStack and similar grids run the suite on real browsers and devices.

## What to automate

The few journeys the business cannot ship broken, plus smoke tests after a
deploy. Push everything else down to unit, contract and integration tests.

## Usage example

Three end-to-end journeys: get a quote and compare carrier premiums; bind and
pay; download the policy documents. Everything else, such as each coverage
rule and each carrier adapter, is covered below the browser.

## Keeping it stable

Select by role or test id, never by layout. Wait on conditions, not time.
Control test data and stub third parties at the network edge. Quarantine and
fix a flaky test; a suite people rerun until green tests nothing.

## Interview caveat

End-to-end tests are slow and broad: they tell you something broke, not what.`,
  ),
  stack(
    "testing-strategy-and-quality-metrics",
    "Testing Strategy and Quality Metrics",
    "Choose the test by risk and boundary, and read metrics as signals.",
    "testing",
    ["testing", "strategy", "contract-tests", "quality", "metrics"],
    `# Testing Strategy and Quality Metrics

## Test by boundary

- Unit: domain rules, transformations, deterministic workflow.
- Contract: an API or message, checked from both sides, so services can change
  independently.
- Integration: persistence, queues, framework wiring, against the real thing.
- End-to-end: the critical customer journeys only.
- In production: canary releases, parity checks, synthetic checks, alerts.

## Metrics worth reading

Escaped defects and where they were found, change failure rate, flaky-test
rate, time to run the suite, and coverage of changed code. Mutation testing
shows whether assertions would notice a bug.

## Usage example

Each carrier adapter has contract tests built from recorded responses,
including a decline and a malformed reply. A defect that reached production in
renewals becomes a failing test first, then a fix, then a note on which
level should have caught it.

## Finding gaps

Start from incidents and from the code that changes most. Ask what would have
caught each incident and at which level.

## Interview caveat

A high coverage number with weak assertions is worse than a lower honest one:
it buys confidence that is not real.`,
    "concept-guide",
  ),

  // ---- Infrastructure and delivery ------------------------------------------------
  stack(
    "docker-and-kubernetes-essentials",
    "Docker and Kubernetes Essentials",
    "Images, containers, and the handful of Kubernetes objects that run a service.",
    "devops",
    ["docker", "kubernetes", "containers", "devops", "deployment"],
    `# Docker and Kubernetes Essentials

## Docker

An image is an immutable, layered file system plus a start command; a
container is a running instance. Use multi-stage builds so the final image
holds only the runtime and the built output. Order layers so dependencies are
cached; run as a non-root user; pin base images.

## Kubernetes objects

- Pod: one or more containers scheduled together.
- Deployment: a desired number of pod replicas and rolling updates.
- Service: a stable address and load balancing for a set of pods.
- Ingress: HTTP routing from outside the cluster.
- ConfigMap and Secret: configuration and credentials.
- Horizontal Pod Autoscaler: replicas follow load.

## Health and resources

Readiness probes gate traffic; liveness probes restart a stuck container.
Requests reserve capacity; limits cap it.

## Usage example

The quoting API runs as a Deployment of four replicas. A rolling update brings
up new pods, waits for readiness (database reachable, carrier configuration
loaded) and only then removes the old ones, so brokers see no interruption.

## Interview caveat

Handle the termination signal: stop accepting requests, finish the ones in
flight, then exit. Otherwise every deploy drops requests.`,
  ),
  stack(
    "infrastructure-as-code-terraform-pulumi",
    "Infrastructure as Code: Terraform and Pulumi",
    "Declared, reviewed and reproducible infrastructure, and how state works.",
    "devops",
    ["terraform", "pulumi", "infrastructure-as-code", "aws", "devops"],
    `# Infrastructure as Code: Terraform and Pulumi

## The idea

Infrastructure is described in files, reviewed like code, and applied by a
tool that computes the difference between what is declared and what exists.

## Terraform

A declarative language (HCL), providers for each platform, a plan step that
shows changes before an apply, modules for reuse, and a state file that maps
declarations to real resources.

## Pulumi

The same model written in a general-purpose language such as TypeScript, so
loops, functions, types and unit tests are available. It also keeps state.

## Practices

- Remote state with locking and encryption; never state on a laptop.
- Plan in the pull request, apply from the pipeline.
- Separate state per environment; small stacks limit the blast radius.
- No manual changes; detect drift.
- Secrets from a secrets manager, not from the repository.

## Usage example

The quoting service's database, queue, container service and DNS are one
module, instantiated for staging and production with different sizes. A new
carrier webhook endpoint is a reviewed change, not a console click.

## Interview caveat

The state file is sensitive and authoritative. Losing or corrupting it is
harder to recover from than losing the code.`,
  ),
  stack(
    "aws-core-services",
    "AWS Core Services for Web Applications",
    "The compute, data, messaging and network pieces a typical service uses.",
    "devops",
    ["aws", "cloud", "devops", "serverless", "architecture"],
    `# AWS Core Services for Web Applications

## Compute

EC2 (virtual machines), ECS and EKS (containers; Fargate removes the hosts),
Lambda (functions per event).

## Data

RDS and Aurora (managed PostgreSQL), DynamoDB (key-value at scale), S3
(object storage), ElastiCache (Redis).

## Messaging

SQS (queues with dead-letter queues), SNS (publish and subscribe),
EventBridge (event routing), Kinesis (streams).

## Network and edge

VPC with public and private subnets, load balancers, API Gateway, CloudFront
and Route 53.

## Security and operations

IAM roles with least privilege, KMS for keys, Secrets Manager, CloudWatch for
logs, metrics and alarms, and X-Ray or OpenTelemetry for tracing.

## Usage example

The quoting API runs on Fargate behind a load balancer, with Aurora
PostgreSQL in private subnets. A bound policy is published to a queue; a
worker renders the policy documents to S3 and the customer downloads them
through a short-lived signed link.

## Interview caveat

Design for more than one availability zone, and know which services are
regional. Cost and limits (Lambda concurrency, database connections) are
architecture inputs, not afterthoughts.`,
  ),
  stack(
    "dora-metrics",
    "DORA Metrics",
    "Four measures of delivery performance, read as signals about the system.",
    "delivery",
    ["dora", "metrics", "devops", "delivery", "continuous-delivery"],
    `# DORA Metrics

## The four

- Deployment frequency: how often changes reach production.
- Lead time for changes: from commit to running in production.
- Change failure rate: the share of deployments that cause a failure.
- Time to restore service: how long recovery takes.

The first two measure throughput and the last two stability. Strong teams
improve both together; they are not a trade-off.

## How to use them

As signals about the delivery system, never as a score for an individual. If
lead time rises, find the constraint: ticket size, review queues, flaky CI,
environments or the release process. Read lead time beside change failure
rate: speed without stability is not good delivery.

## Usage example

Lead time for the quote and policy service is four days, three of them
waiting for review and a weekly release. Smaller pull requests, a review rota and
deploying on merge behind feature flags bring it under a day, while the
change failure rate holds steady.

## What moves them

Small batches, trunk-based development, automated tests, deployment
automation, feature flags, good monitoring and fast rollback.

## Interview caveat

A metric that becomes a target gets gamed. Share the trend with the team and
ask what it is telling you.`,
    "concept-guide",
  ),
  stack(
    "scrum-and-agile-delivery",
    "Scrum and Agile Delivery",
    "The events, the artefacts, and slicing work so it ships.",
    "delivery",
    ["scrum", "agile", "delivery", "planning", "backlog"],
    `# Scrum and Agile Delivery

## Scrum in brief

- Roles: product owner (what and why), developers (how), scrum master (the
  process and its impediments).
- Events: sprint planning, daily scrum, sprint review, retrospective.
- Artefacts: product backlog, sprint backlog, the increment, and a shared
  definition of done.

## Slicing work

Break a roadmap item into epics and epics into small vertical slices, each
delivering something observable end to end. Start by agreeing the outcome and
how it will be measured, then find the smallest slice that proves it.

## Usage example

"Fewer renewals need a broker." First ask where customers drop off and which
policy types need help. The first slice automates renewal end to end for one
low-risk policy type with one carrier; later slices widen coverage with what
that one taught.

## Under deadline pressure

When the date is fixed, change the scope, not the quality bar. State what can
ship safely, what moves to the next increment, and what cannot be compromised:
security, data correctness, auditability.

## Interview caveat

Ceremonies are not agility. The test is whether working software reaches
users in small steps and the team changes course on what it learns.`,
    "concept-guide",
  ),
  stack(
    "technical-debt-and-incident-learning",
    "Technical Debt and Incident Learning",
    "Prioritise debt by its cost, and turn incidents into a few real fixes.",
    "delivery",
    ["technical-debt", "incidents", "delivery", "reliability", "leadership"],
    `# Technical Debt and Incident Learning

## Technical debt

Not "ugly code": a past shortcut that now charges interest. Rank it by what
it costs:

- customer impact and repeated incidents;
- security exposure;
- delivery friction in code that changes often;
- operational burden and knowledge held by one person.

Debt in code nobody touches can wait. Debt in the path of the roadmap is paid
as part of that work.

## Incidents

During: one incident lead, a timeline, one person communicating, hypotheses
tested against evidence, and contain before you cure.

After: a blameless review of the sequence, why controls let it reach
customers, what slowed recovery, and a small number of owned actions.

## Usage example

Renewal notices fail twice in a quarter when a carrier's API slows down. The
review finds no timeout on that call and no alert on the queue. Two actions,
each with an owner and a date: a deadline with a fallback, and an alert on
queue age. The same evidence justifies replacing the renewal scheduler.

## Interview caveat

Ten vague follow-ups change nothing. Two that are owned and finished do.`,
    "concept-guide",
  ),
];
