---
id: ADR-0035
title: "Record every AI interaction with its content in development, as spans exported through OpenTelemetry"
status: Deprecated
date: 2026-10-08
proposed_date: 2026-10-08
accepted_date: null
deprecated_date: 2026-10-08
superseded_date: null
supersedes: []
amends: [ADR-0007, ADR-0012, ADR-0034]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [observability, ai, tracing, opentelemetry]
related_briefs: []
related_research: []
governs: []
---

# ADR-0035 — Record every AI interaction with its content in development, as spans exported through OpenTelemetry

## Context

The owner's rule for development is that every AI interaction is traced end to end with its content:
what came in (for the live assistant, the transcript lines heard), the prompt actually sent, and what
the model returned. A missing step is a defect. An audit on 2026-10-08 found that no call path meets
it. There is no database record of an interaction: `ai.usage_records` has no writer; the live path
keeps the transcript and the validated answer and loses the selection of context sources, the prompt
and the raw output; briefing, document, playground and presentation paths keep less. The only content
trace is the terminal log, which cuts strings at 2,000 characters, drops content in the readable
format, and logs nothing for streamed output.

Three accepted or proposed decisions stand in the way. ADR-0007 forbids logging content by default
and allows it only by explicit opt-in. ADR-0012 makes session traces id-only and purges a session
completely at its end. ADR-0034 routes AI calls through one logger that is quiet about content in
every environment, and rejected OpenTelemetry as more than a local product needed. The owner has
since decided to adopt OpenTelemetry now, having used its GenAI naming for the same purpose elsewhere.

## Decision

- In development, every call to a model is recorded in the database with its content: the input it
  answers, the system and user prompt verbatim and uncut, the context sources that were selected and
  those that were cut with the reason for each, the raw output before validation, the model and its
  parameters, usage, timing, outcome and error, and what the call was for (session and task, briefing,
  document, job).
- The record is written at the AI gateway, the one seam every product already calls (ADR-0007), for
  single, streamed and structured-stream calls and for the correction turn after a failed validation.
  A model call that does not pass through the gateway, or is not recorded to the same shape, is a
  defect.
- The database record is the source of truth and is shaped as a span: a trace id, a span id and a
  parent, so the steps of one request (context selection, the model call, each tool call,
  post-processing) form one tree.
- OpenTelemetry is introduced now. The gateway emits a span per step through the OpenTelemetry API,
  named and attributed by the GenAI semantic conventions, sharing its ids with the database record.
  Where the conventions have no name, attributes take the product's own prefix. With no exporter
  configured the spans cost nothing and nothing leaves the machine.
- Content lives in the tenant-scoped database record. It is not placed on exported spans; a span
  carries the ids that find it.
- One setting decides whether content is captured. It is on by default in development and a service
  refuses to start with it on in production, so ADR-0007's default holds where it matters.
- A development trace is kept for a stated period of its own and is not removed by the session purge
  of ADR-0012. With capture off there is no content to purge, and ADR-0012 is unchanged.
- A person can read a trace back by session, task, document or job, without a database client.
- The terminal log remains for following a run live; it is no longer the record. It prints AI
  content uncut in the readable format when capture is on.

Amended: ADR-0007's "never log content by default" now reads as the production default, with
development capture on. ADR-0012's id-only rule keeps to logs and the session trace; the interaction
record is a separate, content-bearing store that exists only when capture is on. ADR-0034's "quiet
about content in every environment" and its rejection of OpenTelemetry are replaced by this decision.

## Alternatives Considered

### Option A — Keep the terminal log and repair it (no truncation, content in the readable format)
- **Pros:** no schema change, no new dependency.
- **Cons:** nothing durable, nothing queryable, no link from a prompt to the answer it produced or
  to the sources it was built from.
- **Why not:** the rule is a record of every interaction; a scrolling terminal is not one.

### Option B — The database record with OpenTelemetry names, and the exporter later
- **Pros:** the smallest change; a later move to OpenTelemetry is a mapping.
- **Cons:** two steps where one will do; no standard viewer for timing in the meantime.
- **Why not:** recommended first, and the owner chose to adopt OpenTelemetry now.

### Option C — OpenTelemetry only, with prompts and output on the spans
- **Pros:** one system; any trace viewer shows everything.
- **Cons:** content leaves the tenant-scoped database for whatever the exporter points at; span
  size limits cut long prompts; the record depends on a collector being present.
- **Why not:** content stays under row-level security, and the record must exist with no collector.

## Consequences

**Positive:**
- "What did the model read" becomes a read of one record, for every path, including the sources
  that were cut.
- One shape replaces five partial ones (session results, proposal snapshots, document usage, agent
  payloads, the log).
- Selection quality can be measured from recorded runs.

**Negative:**
- A migration, and a new dependency on the OpenTelemetry API and SDK (a scope checkpoint under ADR-0002).
- Development databases hold interview content beyond a session's end; the retention period must
  be chosen and enforced.
- The GenAI conventions are still changing; names adopted now may need renaming.

**Follow-on work:**
- Route the vendored assistant library's model calls through the gateway, or record them to the
  same shape; it bypasses the gateway today.
- Have the live path's context selection return what it kept and what it cut.
- Decide the shared projection package that produces that selection (a following decision).

## References

- [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]]
- [[adrs/ADR-0012-keep-active-session-data-private-to-the-actor-and]]
- [[adrs/ADR-0034-record-native-app-and-companion-events-through-one]]
- [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]
- OpenTelemetry semantic conventions for generative AI (`gen_ai.*`), checked against the current
  specification before any name is frozen.
