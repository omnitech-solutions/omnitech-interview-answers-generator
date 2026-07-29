---
description: Produce an implementation-ready Omnitech platform blueprint
targets: ["*"]
---

# Plan

Turn a ticket, PRD, transcript, discovery note, or feature description into a
self-contained technical blueprint. Planning does not implement code.

## Workflow

1. Read `.rulesync/rules/overview.md`,
   `.rulesync/rules/simplicity-first.md`, and the rules relevant to the change.
2. Activate `codebase-audit` and emit its WORK CONTEXT.
3. Compare small, intermediate, and distributed solutions. Recommend the
   smallest complete choice and record why.
4. Ask at most five questions, and only when an answer changes data, state,
   service, API, permission, rollout, or trust boundaries.
5. Activate `planning` and write one decision-complete blueprint.

## Required blueprint

1. Executive summary and measurable success criteria.
2. Background, current implementation, non-goals, and glossary.
3. Three-solution simplicity gate, recommendation, and scope estimate.
4. Architecture diagram, ownership, runtime topology, and trust boundaries.
5. Decision records, including rejected options.
6. Data model, constraints, indexes, tenant ownership, and migrations.
7. Backend interfaces, repositories, transactions, jobs, and failure types.
8. Detailed success and failure flows with sequence diagrams.
9. API routes, typed requests and responses, status codes, and error shapes.
10. Frontend entrypoints, component contracts, data fetching, state ownership,
    loading, empty, error, and accessibility behavior.
11. Authentication, authorization, connected accounts, secrets, and audit.
12. Configuration, product manifest, tenant installation, feature flags, theme,
    locale, and environment differences.
13. Observability: metrics, structured event fields, traces, alerts, and data
    that must never be recorded.
14. Implementation milestones with exact files, dependencies, and one
    reviewable commit per milestone.
15. Unit, contract, integration, browser, migration, performance, security,
    lint, format, type, test, and build verification.
16. Deployment, backfill, compatibility, rollback, and data recovery.
17. Operational runbooks for the most likely failure states.
18. Risks with concrete mitigations.
19. Future extraction seams that are enabled but not implemented.
20. Assumptions and confirmed defaults.
21. Next implementation action.

Every section must reference actual repository entities. Omit a section only
when genuinely irrelevant and state why. If the selected design adds
infrastructure or exceeds 1,000 changed lines, include a scope checkpoint unless
the user already authorized full implementation.
