---
id: ADR-0041
title: "The first context pack slice derives identities from content and adds three rules"
status: Accepted
date: 2026-10-09
proposed_date: 2026-10-09
accepted_date: 2026-10-09
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0038, ADR-0039]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [context, projection, coach, experience-matrix, grounding]
related_briefs: []
related_research: []
governs: []
---

# ADR-0041 — The first context pack slice derives identities from content and adds three rules

## Context

The owner asked for the context pack over the experience matrix and the interview brief, with the
projection views, and the first slice is implemented (uncommitted at the time of writing).
ADR-0038 decides what the pack is. Four choices made while building it are not in that record or
in ADR-0039, and a reader of those two records alone would expect something else. This record
states them so the owner can overrule any one. It adds no new mechanism; it narrows or fills
four points.

## Decision

- **Identity is derived from content for structured sources (amends ADR-0038).** ADR-0038 has
  whoever imports or stores a source assign each record an identity and keep it. For the
  structured sources of this slice (the experience matrix, the employer brief, the person's
  preferences) nothing is assigned or stored: a role is identified by its employer and title, a
  fact by its role, section and what it says. The property ADR-0038 asks for holds: inserting a
  role changes no other record's identity. A role renamed or a fact reworded is a new record.
  The position stays beside the identity as the fact's pointer. Assigning and storing identities
  at import remains required for unstructured sources and is not yet done.
- **A chosen story widens the question (fills a gap in ADR-0038).** When the selection for a
  question includes a story the person chose for that kind of question, the selection is made
  again with that story's words added to the question's, so the facts of the role that story
  names are found. The result's digest follows the second selection.
- **A question nothing matches is offered the recent roles (fills a gap in ADR-0038).** When no
  fact is selected by the question's words, the person's recent roles are offered, chosen by
  recency alone, in the roles slot, and the result's digest says so. They are still marked as
  that slot, never as a match. A requirement the material cannot answer still resolves as "no
  such fact".
- **A person's stated preferences verify as their own (amends ADR-0039).** ADR-0039 lets the
  record found by the code check make a claim verified. The check now accepts the candidate's
  record and the person's stated preferences, and never the employer's material.

### Worked scenarios

| Situation | Outcome |
|---|---|
| A role is inserted above existing roles | No existing fact's identity changes; pointers shift |
| "Tell me about yourself" matches no fact | The recent roles are offered in the roles slot; the digest ends `+recent-roles` |
| A chosen story names a dispute with a stakeholder | The role that tells it is found by the story's words, not only the question's |
| The coach says "remote first, 90 days notice" and the preference lines say so | Marked verified; the same claim from an employer line is marked inferred |

## Alternatives Considered

### Option A — Assign and store identities now
- **Pros:** exactly as ADR-0038 states.
- **Cons:** needs a stored place for the prepared result, an open owner decision, before any
  structured material can be read at all.
- **Why not:** derived identities give the stability the decision asks for without waiting.

### Option B — Leave the rules in code without a record
- **Pros:** no writing.
- **Cons:** a reader of ADR-0038 would expect different behaviour; the owner could not overrule
  what he did not know was chosen.
- **Why not:** the point of the record is that the choice can be seen and reversed.

## Consequences

**Positive:**
- The coach, an answer and the inspected view share one selection, which now finds the story's
  role and always offers something about the person.
- Facts keep their identity when roles are added or reordered.

**Negative:**
- A reworded fact is a new record, so a pin or note source set on its old wording no longer
  points at it.
- The recent-roles fallback offers roles that do not answer the words asked.
- Two selection rules sit in the product's pack, not in the engine's recipe.

**Follow-on work:**
- Extraction from unstructured text with a kept prepared result, which needs the engine's
  prepared store in Studio's own Postgres (an open owner decision), and identities assigned and
  stored at import.
- The answers, briefing and documents paths still use their earlier selection.
- Budgets from a runtime's reported capacity.
- The coverage, citation and pivot views, and pins and exclusions by a person.
- The pane's drawing was verified by component tests only, not in the live window.

## References

- [[adrs/ADR-0038-prepare-raw-information-into-attributable-context]]
- [[adrs/ADR-0039-a-live-coach-reads-the-conversation-and-writes-the]]
- Measured on 2026-10-09 against the owner's paused session, read-only. Informative: 279 records
  prepared; a selection answered in about 20 ms after the first read; against Claude Code with a
  synthetic record the coach's first line appeared 4 to 5 seconds after each question and used
  the person's chosen story, figures and preferences with verified citations. The numbers bind
  no implementation.
