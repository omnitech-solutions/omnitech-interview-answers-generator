---
title: "Technology references by layer"
slug: technology-references
type: references
tags: [references, react, swift, nextjs, hono, drizzle, security]
sources: [vercel-react-best-practices, vercel-composition-patterns, swift-concurrency-agent-skill]
last_reviewed: 2026-10-04
---

# Technology references by layer

Which vetted outside reference to read when working on each layer of this
repository. These references are **reference data**: they inform a change but
never override `AGENTS.md`, an accepted decision, or a ratified invariant. Where
a reference and a repository rule disagree, the repository rule wins and the
disagreement is worth a note in the change. The router skill is
`.agents/skills/technology-references/SKILL.md`.

## Layer-to-reference map

| Layer | Read | Supports | Notes |
| --- | --- | --- | --- |
| React UI and component composition (`products/*` frontends, Studio, overlay) | [[research/sources/vercel-composition-patterns]] first, then [[research/sources/vercel-react-best-practices]] | [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]], [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]; [[invariants/product-frontend-never-imports-apps-web]] | Composition patterns back the repo's config-driven typed tables, explicit variants over boolean props, and lifted state in a provider. The best-practices rules matter most in their top priorities (waterfalls, bundle size); apply low-priority micro-optimisations only with evidence. React 19 section applies because the workspace is on React 19. |
| Native Swift and WKWebView (`apps/studio-shell`, `apps/capture-companion/macos`) | [[research/sources/swift-concurrency-agent-skill]] | [[adrs/ADR-0019-host-the-overlay-in-a-native-shell-through-one-host-adapter]] | Read the project's Swift language mode, strict-concurrency level and default isolation from each `Package.swift` before applying any rule. The WKWebView and AppKit APIs themselves have no vetted skill; use Apple's documentation. |
| Next.js App Router (`apps/web`) | Official docs: https://nextjs.org/docs/app | [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]; [[invariants/product-domain-never-imports-nextjs]], [[invariants/nextjs-never-launches-agent-processes]] | No vetted skill. Check the Next.js version in the `apps/web` `package.json` and read the docs for that version. The React performance rules above cover the React and server-component side. |
| Hono (product backends) | Official docs: https://hono.dev/docs | [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]; [[invariants/product-routes-resolve-membership-first]] | No vetted skill. Check the Hono version in the product `package.json` files. Tenant membership resolves before domain work on every product route. |
| Zod (validation at boundaries) | Official docs: https://zod.dev | [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]] (explicit input and output types) | No vetted skill. Zod's version comes from the pnpm catalog in `pnpm-workspace.yaml`; read the docs for that major version. |
| Drizzle ORM and migrations (`packages/database`, domain schemas) | Official docs: https://orm.drizzle.team/docs/overview | [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]], [[adrs/ADR-0023-use-the-query-builder-by-default-and-check-the-dat]]; [[invariants/tenant-drizzle-handle-only-via-with-tenant]], [[invariants/schema-files-and-migrations-agree]] | No vetted skill. The workspace pins a Drizzle release candidate, so confirm the documented API against the installed version before copying an example. Tenant access always goes through `withTenant()`. |
| PostgreSQL (RLS, schemas, roles) | Official docs: https://www.postgresql.org/docs/ (choose the server version used in `compose.yaml`) | [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]]; [[invariants/tenant-owned-tables-force-rls]] | No vetted skill. Row-level security chapter and the `CREATE POLICY` and `ALTER TABLE ... FORCE ROW LEVEL SECURITY` references are the canonical ones. |
| AI and the Anthropic SDK (`packages/ai-*`, `apps/agent-worker`) | The official `claude-api` skill for SDK and model questions; the project skill `.agents/skills/ai-provider-maintainer` for provider changes; [[research/references/ai-execution-boundaries]] | [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]]; [[invariants/products-never-branch-on-provider-names]], [[invariants/nextjs-never-launches-agent-processes]] | Provider SDKs stay inside `ai-provider-*` packages. Never log prompts or model output. Check `@anthropic-ai/sdk` and `@anthropic-ai/claude-agent-sdk` versions in the owning `package.json`. |
| Security and code review | The `security-review` and `code-review` skills | [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]], [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]], [[adrs/ADR-0006-keep-login-identities-separate-from-connected-prov]]; [[invariants/package-boundaries-hold]] | Run them on the branch diff before claiming completion; they complement `pnpm verify`, they do not replace it. |

## Considered and not filed

- **Vercel `web-design-guidelines`** (same upstream repository as the two filed Vercel skills). Rejected for now: its `SKILL.md` tells the agent to fetch its rules from a remote URL at run time, so remote text could steer the agent after review. Reconsider only from a pinned, reviewed copy of the rules ingested through `ingest-research`.
- **Community Drizzle, Hono and Next.js skills** found by web search on 2026-10-04. Their authors, licences and commits were not vetted, so nothing was ingested and no content was read into this wiki. Locations only:
  - https://github.com/oakoss/agent-skills/blob/main/skills/drizzle-orm/SKILL.md
  - https://github.com/BarisSozen/claude/blob/main/.claude/skills/pitfalls-drizzle-orm/SKILL.md
  - https://github.com/gocallum/nextjs16-agent-skills
  - https://github.com/littleben/awesomeAgentskills
  - https://shyft.ai/skills/hono-skill
  - https://www.skillsdirectory.com/skills/jezweb-drizzle-orm-d1
  - https://claudemarketplaces.com/skills/bobmatnyc/claude-mpm-skills/drizzle-orm
  Revisit when an author, licence and pinned commit can be checked.

## Refresh policy

Each source is pinned by upstream commit in its source page and raw capture
(`PROVENANCE.md`). Refresh with `refresh-research-sources`, which preserves a new
dated capture and flags this page; then reconcile it with
`refresh-research-synthesis` under review. Official-docs rows are not captured
sources; re-check the installed version when working in that layer.

## Sources

- [[research/sources/vercel-react-best-practices]]
- [[research/sources/vercel-composition-patterns]]
- [[research/sources/swift-concurrency-agent-skill]]
