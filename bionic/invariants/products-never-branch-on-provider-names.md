---
id: INV-0006
class: contract
provenance: recovered
ratification: ratified
verification:
  last_result: fail
related_adrs: [ADR-0007]
related_briefs: []
checks: [products-never-branch-on-provider-names.md]
---

# INV-0006 — products-never-branch-on-provider-names

> **observed** — a recovered candidate, not a ratified invariant. Only the owner
> ratifies or rejects it, via `transition-invariant`.

**Intent:** Product code requests AI work by profile or capability through `AiExecutionGateway` and never branches on a provider or model name.

**Why:** [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]].

**Recovery confidence:** **contract** — low confidence. A name grep is a proxy: it flags literal provider names, not every branch on a configured value. Expect to refine the pattern at ratification.

**Check:** [[invariants/checks/products-never-branch-on-provider-names]] — run 2026-10-05; `last_result: fail`. The grep now has matches that no owner has reviewed: `products/interview/src/frontend/studio/documents/assistant-model.ts:6,35` prefers the target `agent/claude-code` when choosing a document target (a branch on a provider-named target id, the case this pin forbids); `products/interview/src/frontend/studio/live/shared/task-card-model.ts:298,305,431` maps the runtime ids `claude-code` and `codex` to a display label and quotes a model id in comments (display only). The 2026-10-02 `pass` predates these files. Not masked: owner review or a code fix decides it.
