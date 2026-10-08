# packages/ai-provider-openai/src/index.ts

_Source: `packages/ai-provider-openai/src/index.ts` (header-comment fallback)_

A structured task streams the same JSON object execute() would return:
the schema rides the request and the completed event carries the
parsed object (or the raw text when it is not valid JSON for the
schema, so the caller's own validation reports it). A plain stream
completes with its id alone, as before.
