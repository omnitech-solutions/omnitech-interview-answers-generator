# products/interview/src/frontend/studio/live/testing/missing-context-kit.ts

_Source: `products/interview/src/frontend/studio/live/testing/missing-context-kit.ts` (header-comment fallback)_

Test support for the missing-context journey: a scripted Active Session whose
first revision of a screenshot task reports missing context, and whose
owner-input and capture routes behave like the worker: the input revises the
task it targets (a new revision, newer than every action before it) and the
answer for that revision reports `nextMissing`. A fake server only: whether a
real model flags a cut-off page is not shown by anything built on this.
