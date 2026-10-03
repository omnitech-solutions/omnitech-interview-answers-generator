---
id: ADR-0003
title: "Keep package boundaries narrow with one public entrypoint per runtime surface"
status: Accepted
date: 2026-10-02
proposed_date: 2026-10-02
accepted_date: 2026-10-02
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [packages, boundaries, monorepo, database]
related_briefs: []
related_research: [concepts/interview-domain-model, concepts/platform-architecture]
---

# ADR-0003 — Keep package boundaries narrow with one public entrypoint per runtime surface

## Context

The repository is a pnpm/Turbo monorepo of `apps/*`, `packages/*` and
`products/*`. Each package is consumed through its `package.json` `exports`.
The `database` package owns connectivity and migration execution, while each
domain package owns its own schemas
([[research/concepts/interview-domain-model]],
[[research/concepts/platform-architecture]]).

## Decision

1. **Entrypoints.** A package exposes one public entrypoint per intentional
   runtime surface and exports its public types from those entrypoints.
   Consumers never import a package's internal files.
2. **Ownership.** Each package owns one responsibility:
   - `platform-contracts` — stable framework-neutral platform and product
     contracts.
   - `platform-runtime` — trusted product registration and route resolution.
   - `platform-api` — platform HTTP contracts, without importing Next.js.
   - `database` — PostgreSQL connectivity, tenant-scoped transactions
     (`withTenant`, `tenantTransaction`), and migration execution.
   - `platform-storage` — the `platform` and `ai` schemas, platform
     repositories, and encryption boundaries.
   - `platform-integrations` — OAuth protocol behavior, without UI or database
     access.
   - `products/*` — complete product verticals: manifest, frontend, backend,
     services, tests.
   - `ai-contracts`, `ai-runtime`, `ai-provider-*`, `agent-runtime-*`,
     `agent-job-service`, `agent-worker` — the AI execution split decided in
     [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]].
   - `interview-contracts` — schemas, language routing, and answer workflows.
   - `interview-storage` — persistence interfaces and adapters.
   - `code-runner` — execution isolation.
   - `interview-api-client` — hides HTTP paths, headers, and response
     handling.
   - `interview-cli` — a thin automation surface over the API client.
   - `apps/web` — the thin Next.js shell
     ([[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]).
3. **Schemas.** Domain packages (`platform-storage`, `products/*`) declare and
   own their schemas and repositories; `database` owns no domain schema.
4. **New boundaries.** A new package is added for a demonstrated second
   implementation or an independent lifecycle
   ([[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]).

## Consequences

**Positive:**
- Package changes are local; a public entrypoint states the contract.
- Ownership questions have one answer per package.

**Negative:**
- Adding a capability sometimes means widening an entrypoint deliberately
  rather than reaching into internals.
- The ownership list must be kept current as packages are added; the derived
  module graph (`bionic/arch/module-graph.md`) shows the current set.

## References

- `exports` in each `packages/*/package.json` and `products/*/package.json`.
- Invariant checks [[invariants/checks/product-frontend-never-imports-apps-web]]
  and [[invariants/checks/product-domain-never-imports-nextjs]].
- [[research/concepts/interview-domain-model]]
- [[research/concepts/platform-architecture]]
