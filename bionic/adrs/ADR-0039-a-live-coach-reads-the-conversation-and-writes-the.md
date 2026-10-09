---
id: ADR-0039
title: "A live coach reads the conversation and writes the coach's notes as it happens"
status: Accepted
date: 2026-10-08
proposed_date: 2026-10-08
accepted_date: 2026-10-08
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [coach, live-session, agents, transcript, grounding]
related_briefs: []
related_research: []
governs: []
---

# ADR-0039 — A live coach reads the conversation and writes the coach's notes as it happens

## Context

The live session already answers a question the candidate is asked. It does not help in the
conversation around the question: the interviewer's framing, a follow-up, a moment where a story
from the candidate's own record would land. The owner asked for an AI process that listens to the
conversation and coaches the interviewee ("transcript is the input to AI"), through Claude Code
and Codex, "without over loading the user", streamed, and "super pro-active". The bar he set is
results better than the coach's notes written by hand for the same conversations.

Two limits shape the design. A person can read a few lines at a glance while the conversation
never stops, so a coach that speaks often is worse than none. And the transcript is the most
sensitive material in the product: it must not reach a database, a file or a log (ADR-0007), and
a conversation that stayed on the candidate's device (ADR-0012) must never be read by a model.

## Decision

- A coach is a process that reads the conversation and writes notes for the candidate. It reads
  the transcript through a Studio API and posts its notes through another; it holds no
  other channel into the product.
- The transcript contract lives with the interview contracts. A line says who spoke, what was
  said and when, and may name the live session it was heard in. The transcript is held in memory
  by the Studio process, in one place, and is never written to the database, a file or a log. A
  restart empties it, and a reader can tell that it was emptied.
- Two things feed it. A newly stored transcript line of a live session whose locality permits a
  remote model (ADR-0012) is added as it arrives. A recorder's exported transcript can be
  attached or replayed from a command. A session that is device-only is never read.
- The coach runs in the agent worker only, as an agent runtime (ADR-0007, ADR-0037), on Claude
  Code or Codex as the owner chooses by configuration. It is off unless a runtime is chosen and
  the Studio API token is set. It reaches Studio over its API with that token, like any coach.
- The coach does not overload the person:
  - one model call at a time, started only when something worth a note has been said and the
    speaker has paused;
  - the model may answer that nothing is worth saying, and then nothing is shown, including
    for a greeting;
  - a note is shown as it is written, as rising revisions of one note, so the first line is on
    screen within moments, and a reader that already shows the latest revision is told there is
    nothing new;
  - the reply is a line-by-line protocol, so every line finished by the model can be shown
    without waiting for the rest.
- A note rests on the candidate's approved record. When the transcript was heard in a live
  session, the coach is grounded in that session's approved context through the session's own
  loading and selection, not a second path.
- A claim in a note is marked verified only when a check in code finds it in the supplied fact
  text and any figure it states matches. Everything else is marked inferred. The model's own
  claim of verification is never taken.

### Worked scenarios

**1. The interviewer asks about scale.**

| Step | What happens | The person sees |
|---|---|---|
| Interviewer finishes a question about handling load and pauses | The coach starts one call, grounded in the approved record | — |
| First line arrives from the model | Posted as revision one of a note | A one-line prompt, within a few seconds |
| More lines arrive | Posted as later revisions of the same note | The same note grows; nothing new appears beside it |
| A figure the model quotes matches the record | Marked verified | A verified mark on that claim |
| A figure the model quotes is not in the record | Marked inferred | An inferred mark |

**2. Small talk.**

| Step | What happens | The person sees |
|---|---|---|
| Both sides greet each other | The coach waits for the pause and asks | — |
| The model answers that nothing is worth saying | No note is posted | Nothing |

**3. A conversation that stays on the device.**

| Step | What happens |
|---|---|
| The session is device-only | Its lines are not added to the coach's transcript |
| The coach asks Studio for the transcript | It receives nothing from that session |
| The candidate attaches a recorder's transcript from a command | That transcript is read; it has no live session, so notes rest on the conversation alone |

**4. Studio restarts mid-conversation.**

| Step | What happens |
|---|---|
| Studio restarts | The held transcript is empty and says it was emptied |
| The coach reads again | It starts from what it is given now and does not replay what it had seen |

## Alternatives Considered

### Option A — Store the transcript so the coach survives a restart
- **Pros:** continuity across restarts; a replayable record.
- **Cons:** the most sensitive material in the product would sit in a database or a file, against
  the rule that content is not stored by default.
- **Why not:** what the person says is not ours to keep.

### Option B — Run the coach inside the web server
- **Pros:** one less process.
- **Cons:** an agent runtime starts a process, and the web server never launches one (ADR-0007).
- **Why not:** the boundary is the point.

### Option C — Wait for the full answer and show it whole
- **Pros:** simpler to parse.
- **Cons:** the note arrives after the moment it was for.
- **Why not:** a note that is late is no note; streaming is required.

### Option D — Trust the model's own statement that a claim is verified
- **Pros:** no extra code.
- **Cons:** it is the model grading itself; a wrong figure would carry a verified mark.
- **Why not:** only a check in code against the record may confer the mark.

## Consequences

**Positive:**
- The candidate gets short, grounded prompts during the conversation, and silence when none
  would help.
- A verified mark means a check in code found the claim in the record.
- Both Claude Code and Codex serve as the coach with no change to the product.

**Negative:**
- The transcript is lost on restart by design.
- The coach's transcript is one per Studio process, not one per tenant, as the coach notes are.
- An attached transcript is grounded in the candidate's record only when a live session has been
  heard since Studio started.
- The candidate's own microphone lines reach the coach only when the companion sends them
  through the ingest path.
- Every note costs an agent run.

**Follow-on work:**
- The fuller context pack (ADR-0038: prepare, resolve, projection views) will replace the
  session's ranking as the coach's source of facts.
- A transcript and notes per tenant.

## References

- [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]] (agents run only in the worker)
- [[adrs/ADR-0011-host-the-active-session-processor-in-the-agent-worker]] (the live session)
- [[adrs/ADR-0012-keep-active-session-data-private-to-the-actor-and]] (locality)
- [[adrs/ADR-0037-consolidate-every-ai-interaction-behind-one-sdk-in]]
- [[adrs/ADR-0038-prepare-raw-information-into-attributable-context]]
- Measured on 2026-10-08 against the real runtimes with a synthetic conversation. Informative:
  the first line on screen about 5 seconds after the question on Claude Code (sonnet) and about
  7 seconds on Codex; silent on greetings. The numbers bind no implementation.
