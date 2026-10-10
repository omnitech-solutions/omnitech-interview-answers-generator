# products/interview/src/backend/context-pack/brief-sources.ts

_Source: `products/interview/src/backend/context-pack/brief-sources.ts` (header-comment fallback)_

The interview brief as sources the AI engine prepares (ADR-0038): each
stage's notes, outcome and people, what the employer said, the research
documents and each stage's transcripts. No model is called here: the text a
person typed or imported is cut into records in code, each with an
identity, a revision (the hash of what it says) and, where it has one, its
STAGE.

[DOMAIN] What each part becomes (phase 3 reads exactly these):
stage:<stageId>:notes                 kind "candidate-notes"
records "prep-note", one per line of the notes
stage:<stageId>:outcome               kind "stage-outcome"
records "prep-note": what happened, what comes next
stage:<stageId>:details               kind "stage-details"
records "employer-fact": when and how, and each person met
stage:<stageId>:transcript:<id>       kind "transcript"
records "transcript-turn", one per speaker turn: RAW, in no slot
employer-said:<entryId>               kind "employer-said"
records "employer-fact", one per line the employer said
research:<documentId>                 kind "research"
records "employer-fact", one per passage
A record of a stage carries `fields.stage` (its place, 1 first) and
`fields.stageId`. Nothing here is ever the candidate's own record.

[SAFETY] A transcript taken under a device-only policy is prepared like any
other (preparing runs on this machine), and every turn of it says
`deviceOnly: true`. Whoever sends a source to a model that does not run
here asks `sourceMayLeaveDevice` first; `remoteSources` is that question
asked of a whole list.
