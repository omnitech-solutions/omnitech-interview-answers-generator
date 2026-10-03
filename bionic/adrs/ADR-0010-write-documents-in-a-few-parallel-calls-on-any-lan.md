---
id: ADR-0010
title: "Write documents in a few parallel calls on any language profile"
status: Accepted
date: 2026-10-03
proposed_date: 2026-10-03
accepted_date: 2026-10-03
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0009]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [interview, documents, ai, agents, performance]
related_briefs: []
related_research: [references/ai-execution-boundaries]
governs:
  - domain: interview-documents
    rule: "A document is written in at most the configured number of structured calls, one call when the template fits within one call's field budget, each over contiguous model-filled fields in template order, through AiExecutionGateway against a template revision and an immutable candidate-profile revision."
    scope: products/interview/src/backend/documents
    handle: ADR-0010/parallel-document-generation
    provenance: authored
    retires: [ADR-0009/structured-document-generation]
  - domain: interview-documents
    rule: "Any gateway language profile that declares structured generation may write documents, including the agent profiles, and an agent call runs only as a bounded read-only job in the agent worker."
    scope: apps/web ai gateway and products/interview documents
    handle: ADR-0010/agent-profiles-write-documents
    provenance: authored
  - domain: agent-worker
    rule: "A worker renews each running job's lease, stops the agent when the lease is lost, and brings every cancel it notices to a terminal state."
    scope: apps/agent-worker
    handle: ADR-0010/running-jobs-keep-their-lease
    provenance: authored
  - domain: interview-documents
    rule: "The call cap, fields per call, tries, field length, worker concurrency and lease are deployment settings with defaults and bounds; a value out of bounds stops startup and names the setting."
    scope: products/interview documents and apps/agent-worker
    handle: ADR-0010/generation-limits-are-configured
    provenance: authored
  - domain: interview-documents
    rule: "Generation progress reaches the page as a stream, a document is saved only when complete, and generation stops with its reader."
    scope: products/interview documents API and frontend
    handle: ADR-0010/generation-stops-with-its-reader
    provenance: authored
---

# ADR-0010 — Write documents in a few parallel calls on any language profile

## Context

ADR-0009 has a document written in one structured call. Using it with Claude Code showed four things.

- The wait follows how much the model writes. A long template is a long wait: the largest built-in template needed minutes in one call.[^1]
- Many small calls are worse than one. Each call re-reads the candidate's profile and writes its own prose, so splitting by section made the model write more in total, at several times the cost, and the worker ran them one at a time.[^1]
- Only one job ran at a time in the agent worker, so parallel calls would have queued behind each other.
- A person who left the page lost a document that was still being written, and the server kept spending on it.

The assistant's picker already offers Claude Code and Codex as models. A person expects a document to be written by the model they chose.

## Decision

A document is written in the fewest parallel structured calls that suit its size. The default cap is four calls, and the cap is a setting bounded at eight. A template small enough for one call is written in one. Fields the server fills from the matrix, the application or the interview are not sent to the model. Each call covers contiguous fields in template order, and the calls' results are merged in template order. A call that fails to complete is tried again up to the configured tries; malformed output is never retried, and any call that fails for good stops the others. The most calls a document makes is its call cap times its tries, plus any reclaim of an expired job.

Any gateway language profile that declares structured generation may write documents, including the Claude Code and Codex agent profiles. An agent call is a read-only job in the agent worker that the caller awaits; the job is tenant-scoped, and neither its prompt nor its result is logged (ADR-0007). The caller validates the output exactly as for any other profile, and Next.js never launches an agent. A person's model choice in the assistant is the default for documents, falling back to the configured default document profile, chosen by its structured-generation capability, when that model cannot write them. Agent profiles do this one-shot work, which ADR-0007 would otherwise send to direct model execution, because the person's chosen model may be an agent; this ADR depends on ADR-0007's gateway and logging rules.

The agent worker runs a configurable number of jobs at once. Its default is above the default call cap; an operator who raises the call cap raises the worker's concurrency above it, or assistant turns queue behind a document. A job is owned by the worker that claimed it:

- A running job's lease is renewed until the job ends, and no other worker claims it while the lease holds.
- A worker whose lease is lost, or that has renewed nothing for a whole lease, stops the agent. Every write to the job (status, session, result, events) applies only for the claiming worker.
- A job whose lease expired while running is run again from the start on reclaim. A caller that sees a second start fails that try and stops the job, so two runs' output is never joined.
- A cancel is noticed within one lease-renewal interval even when the agent is quiet. A cancel that races a completion, and a cancel on a job no worker is running, both end in a terminal state.

How a document is written is configuration: the call cap, the fields one call is worth, the tries per call, the words asked of each field, and the worker's concurrency and lease. Each has a default, an environment variable, and a bound; a value outside its bound stops startup and names the setting. The length asked of each field is part of the built-in templates' instructions. Built-in templates are provisioned lazily and idempotently, so a changed length setting adds a new template revision on first use and never rewrites an old one.

Progress reaches the page as it happens: the plan, each section when it is written, and the saved document. Streamed sections are provisional until the document is saved, and a document is saved only when complete. When the reader of the stream goes away, generation stops and nothing is saved, as ADR-0009 requires of a cancelled first generation.

A second request for the document being written is refused while the first runs. That guard lives in one server process and is best effort; ADR-0009's unique selection key, and its refusal of a second first generation, remain the correctness boundary across processes.

This amends only ADR-0009's "one structured call". Its ownership, privacy, revision and export rules stand.

## Alternatives Considered

### One call, as before
- **Pros:** the cheapest document, one prompt, simplest to reason about.
- **Why not:** the wait is the model's whole output, with nothing to show until the end.

### One call per section
- **Pros:** the clearest progress, and the smallest failure unit.
- **Why not:** measured slower and several times costlier than one call; per-call cost and extra prose outweigh the parallelism.

### Generate in the background and keep the result after a reload
- **Pros:** nothing is lost when the page goes away.
- **Why not:** a document would exist before it is valid, which ADR-0009 rules out, and it needs a job lifecycle for documents. Deferred until losing work to a reload proves common.

## Consequences

**Positive:**
- A long document is written in a fraction of the one-call time, and the page shows it filling in.
- Documents are written by the model the person chose.
- Abandoning a document stops the spend.

**Negative:**
- A document costs more than one call: each call re-reads the profile.
- Several Claude or Codex processes run at once on the person's login.
- Worker concurrency is an operations setting, and a worker not restarted keeps running one job at a time.
- Parallel calls can meet a provider's rate or quota limit sooner than one call would; a call refused for that reason is a failed call.
- Retries multiply spend, bounded by the call cap times the tries.
- Changing a length setting adds a new built-in template revision.

**Follow-on work:**
- End every job with an event a reader can see, including the missing-runtime and swept-cancel paths.
- Keep one claim loop's unexpected error from closing the database under its siblings.
- Count failed renewals toward a bounded retry and confirm a bad setting stops the Next.js server, not only the worker.
- Require unique worker identities at startup.
- Revisit background generation if reloads lose work often.
- Record agent token use and cost on a document revision.

## References

- [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]]
- [[adrs/ADR-0009-keep-interview-documents-in-the-interview-product]]
- [[research/references/ai-execution-boundaries]]

[^1]: Informative; binds no implementation. Measured against Claude Code (Sonnet, medium effort) on one machine: a 180-field interview prep in one call took about 130 seconds and wrote about 17,000 tokens; ten per-section calls wrote about 4,000 to 5,500 tokens each, took 30 to 50 seconds each, and cost about $0.17 each against about $0.43 for the one call.
