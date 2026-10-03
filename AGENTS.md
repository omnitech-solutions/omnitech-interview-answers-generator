# AGENTS.md — Omnitech Studio

Orientation for every agent (Claude Code, Codex, OpenCode) and human working in
this repository. This file is the map and the guardrails; decisions, research,
and the journal live in `bionic/`.

See `bionic/AGENTS.md` for documentation operations.

Read `bionic/objectives.md` before work of any size, and carry its context through every delegation.
`bionic/AGENTS.md` §5.B is the one statement of what that means — who reads, when, what a delegation carries, how the mission bounds the work, and what to do when the file is missing or still a placeholder.[^objectives]

[^objectives]: rule:objectives-read-before-work, rule:orchestrators-read-objectives-at-startup-and-resume, rule:objectives-shape-the-work-and-authorize-none, rule:objectives-context-travels-with-every-delegation, rule:objectives-populate-gate-never-invents-a-goal

## Mission

Help a software engineer prepare for and perform in technical interviews:
explainable, runnable answers, realistic rehearsal, and briefings they can say
aloud — drivable by coding agents, inside a tenant-aware platform that can host
further products. The goals are in `bionic/objectives.md`.

## Development workflow

Crux is the only development workflow (ADR-0001).

- Explore an idea with `whiteboarding`; capture pre-decision thinking as a
  brief with `propose-brief`.
- Record an architectural decision with `propose-adr`; change its status only
  with `transition-adr`.
- Deliver work through the tier that fits: `dev-cycle` (architectural),
  `iterate` (non-architectural fix), `patch-cycle` (small, reversible),
  `fix-directly` (bounded defect, failing test first).
- Answer questions about the project with `query-docs`; record finished work
  with `log-work`.
- Documentation lives only in `bionic/`. Never hand-edit its regenerated parts
  (`code/`, `arch/`).
- Project skills live once in `.agents/skills/`; `.claude/skills` and
  `.opencode/skills` link to it. Edit skills and this file directly — nothing
  generates them.

## Architecture rules — do not violate

1. Simplicity first: choose the least complex design that meets current
   requirements, with no speculative layers, libraries, or infrastructure.
   Add an abstraction only for a second implementation or an independent
   lifecycle. Surface a scope checkpoint before a change that adds
   infrastructure or exceeds 1,000 changed lines. (ADR-0002)
2. Each package has one responsibility and one public entrypoint per runtime
   surface; never import another package's internal files. `database` owns
   connectivity, `withTenant()`, and migrations; domain packages own their
   schemas. (ADR-0003)
3. `apps/web` is a thin shell. `products/*` own their whole vertical:
   manifest, frontend, Hono backend, services, and tests. Product frontend
   never imports `apps/web`; domain code never imports Next.js. (ADR-0004)
4. Products register at build time; tenant installations own labels, order,
   visibility, and settings. Every product route is
   `/t/:tenantSlug/p/:productId/*` and resolves tenant membership before any
   domain work. (ADR-0004)
5. One PostgreSQL cluster: a `platform` schema plus one schema per owner.
   Every tenant-owned row carries `tenant_id`, row-level security is forced,
   and tenant foreign keys are composite on `(tenant_id, id)`. Tenant-scoped
   Drizzle access goes through `withTenant()`; migrations are one Drizzle
   stream in `packages/database/drizzle`. (ADR-0005)
6. Login identities prove who the user is; connected accounts separately
   authorise provider actions through their own OAuth flow, with encrypted
   tokens never sent to the client. Never reuse login tokens for
   integrations. (ADR-0006)
7. Products call `AiExecutionGateway` by profile or capability and never
   branch on provider or model names. Codex and Claude Code run only in
   `agent-worker`; Next.js never launches an agent process. Agent profiles are
   typed, versioned, and bounded — never raw CLI arguments, environment
   variables, directories, MCP servers, or permission bypasses from users.
   (ADR-0007)
8. Never log questions, prompts, generated content or code, notes,
   attachments, credentials, or model responses by default. (ADR-0007)
9. An interview answer's structured guide is the source of truth; its Markdown
   is always rendered from the guide. (ADR-0008)

## Engineering contract

- Prefer the smallest complete change that makes the current requirement work.
- Simplicity comes first: choose the least complex design that satisfies every
  explicit requirement and constraint; avoid speculative layers, libraries, or
  architecture.
- Before coding, extract essential requirements, constraints, required API or
  entry point, observable behavior, and failure boundaries. Treat them as a
  completion checklist and visibly address each one.
- Keep answers specific to the problem and its domain vocabulary. Avoid generic
  boilerplate or advice detached from the supplied code and constraints.
- Keep deterministic unit and contract behavior in package tests. Put Docker,
  framework-image, browser, or provider-boundary checks in explicit integration
  tests and make the required environment visible in the command and failure.
- Keep reusable boundaries narrow: one responsibility, one public entrypoint,
  explicit input/output types, and implementation details kept private.
- Use domain names. Keep orchestration readable from top to bottom.
- Verify lint, format, types, tests, and build (`pnpm verify`) before claiming
  completion.

## Interview answers

- Put PROBLEM, STRATEGY, and COMPLEXITY comments at the top of the main
  solution. Use `[COMMENT]`, `[GUARD]`, `[DOMAIN]`, `[STRATEGY]`, `[SAFETY]`,
  and `[TRACE]` labels. Inside the entry-point and helper bodies, add a concise
  comment immediately before every major logical block: guards/normalization,
  state and invariants, each algorithmic pass, consequential branch, and result
  assembly. Header comments do not satisfy this body-comment requirement.
  Explain why the block exists and what remains true; do not narrate
  individual syntax.
- When the prompt supplies a concrete example, put a `[TRACE] Input:` comment
  inside the entry-point body containing the original arguments and their
  concrete values. Later `[TRACE]` comments use that same example and values
  consistently — never invent, rename, or silently change them. Keep full
  expected outputs in `usageCode` or tests.
- Keep the exact required entry-point function or component above all helpers.
- Keep the main solution, executable usage/output, and executable tests in
  separate answer fields so the Playground can edit them as tabs and run them
  in order.
- The explanation is rendered from the guide as Markdown: concise point form
  for **Question**, **Approach**, **Complexity**, **Edge cases**, and
  **Talking points**, with key domain terms, invariants, trade-offs, and
  complexity notation in bold.
- Concept explanations must be deliverable aloud: **30–60 seconds** for a
  simple question, **60–90 seconds** only for a genuinely multi-part one.
  Concise point form, one Collapse per supplied question, and exactly three
  practical talking points. Choose an example format that fits: short
  commented code for implementation mechanics, a compact table for
  comparisons, concrete bullets for web/backend concepts, an invariant and
  complexity for DSA patterns, or an evidence-backed mini-STAR for experience
  questions. Avoid repetition and exhaustive reference material.

## Automatic routing

When the user supplies an interview question, activate the
`interview-question-router` skill, then use the
`interview-playground-controller` skill to update the open Playground through
`interview-answers playground`. Use an explicitly selected language; otherwise
detect PHP, React, TypeScript, or Ruby and default ambiguous DSA questions to
TypeScript. Answer directly; start a Rehearsal only when asked
(`/mock-interview`).
