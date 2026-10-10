# products/interview/src/backend/context-pack/eval/render-call.ts

_Source: `products/interview/src/backend/context-pack/eval/render-call.ts` (header-comment fallback)_

Renders a fixture's written call (call/scenario.json) into the files a
benchmark reads: call/transcript.txt and call/expected.json.

tsx products/interview/src/backend/context-pack/eval/render-call.ts <fixture>

[DOMAIN] Nothing here is random or dated: running it twice writes the same
bytes. It prints the transcript's SHA-256, which the fixture's stages.json
names for the transcript it reads from `textFile`.
