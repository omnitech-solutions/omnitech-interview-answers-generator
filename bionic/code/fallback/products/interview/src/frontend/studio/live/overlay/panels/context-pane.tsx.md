# products/interview/src/frontend/studio/live/overlay/panels/context-pane.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/context-pane.tsx` (header-comment fallback)_

What the answers are built from, beside them: the person's experience matrix
and the interview brief, laid out the way the model is given them, with a
line on each saying how it is used. The matrix can be read in each of the
ways it is consumed (matrix-projections.ts) and edited where it stands:
every save is a new revision, and any earlier one can be read or restored.

[DOMAIN] How the model is given this (context-snapshot.ts on the server, in
the same order as below): the brief's lines lead, then the facts of the
roles that best match the question, then the rest of the employer's
material.
