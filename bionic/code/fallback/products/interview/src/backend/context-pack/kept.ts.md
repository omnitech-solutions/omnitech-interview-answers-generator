# products/interview/src/backend/context-pack/kept.ts

_Source: `products/interview/src/backend/context-pack/kept.ts` (header-comment fallback)_

A pack a model prepared, read with today's material.

PROBLEM: a model prepares an application's pack once (prepare.ts) and the
engine keeps it; every reader (the live coach, a briefing, a document, the
view a person inspects) must use what it extracted WITHOUT a model on its
own path, and must never read a fact whose source has changed since.
STRATEGY: a reader prepares today's material in code, as it always did,
and this file adds to it what the kept pack holds that still stands: the
records a model extracted from a source that is at the same revision now,
the ties whose two ends are both still there, and what the person did in
the review. Nothing here asks a model, and with no kept pack nothing here
runs: the reader has exactly what it had before.
COMPLEXITY: O(records + links), once per pack.
