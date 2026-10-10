# products/interview/src/backend/context-pack/links.ts

_Source: `products/interview/src/backend/context-pack/links.ts` (header-comment fallback)_

Links between what a person prepared and what they did, made in code.

PROBLEM: a prep note says "Proof: Copperleaf, 3M+ learners" and the pack
still offers another employer's evidence, because nothing ties the note to
the role it names. STRATEGY: after the sources are turned into records, one
pass reads each story, prep note and requirement and records what it points
at, by rules a person can check. No model is asked: a link is only made
where the words themselves make it.
COMPLEXITY: O(records x roles) for names, O(notes x achievements of the
named roles) for figures.

[DOMAIN] The three links, strongest first:
- `achievements`: an achievement of a named employer whose figure the
line states with one of the achievement's own words beside it ("65%
fewer vulnerabilities" for "security vulnerabilities: 65%"). The figure
alone is not enough: "60% implementation" is not "defects: 60%".
- `roles`: an employer the line names. A name is the employer's whole
name ("Larchmont Pay"), or its first word where the material only ever
writes that word as a name ("Copperleaf" for "Copperleaf Learning").
- `technologies`: a technology of the person's own stack that a
requirement names ("PostgreSQL" in "Relational modelling in
PostgreSQL"). Any achievement done on that technology bears on it.
A requirement also takes a `roles` link through the person's notes: when
it names a technology of the employer's stack ("NestJS") and a prep note
says that technology and names exactly one employer, the requirement is
tied to that employer, though the person's record never says the word.
A requirement keeps the technologies it names in `fields.technologies`, so
one named there counts as one named by an achievement does (recipe.ts).
A link is stored as an object under `fields.links`, which selection never
matches on: it changes which evidence is preferred, never what is found.
