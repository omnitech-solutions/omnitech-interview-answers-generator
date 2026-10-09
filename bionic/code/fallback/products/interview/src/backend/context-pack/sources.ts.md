# products/interview/src/backend/context-pack/sources.ts

_Source: `products/interview/src/backend/context-pack/sources.ts` (header-comment fallback)_

A person's material as sources the AI engine prepares (ADR-0038): the
experience matrix, the employer brief and the person's preferences, each
record with an identity, a kind, the words a model reads, the fields a
look-up reads, and where in the material it came from.

[DOMAIN] Identity is not position. A role is named by its employer and
title, a fact by its role, its section and what it says, so inserting a
role above it changes no identity. The position is kept beside it as the
`locator` ("/roles/3/proof_points/1"): the address the windows already
open, valid for the revision it was read at.
These sources are structured, so preparing them calls no model.
