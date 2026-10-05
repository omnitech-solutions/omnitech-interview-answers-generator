# packages/agent-runtime-codex/src/strict-schema.ts

_Source: `packages/agent-runtime-codex/src/strict-schema.ts` (header-comment fallback)_

OpenAI's strict structured-output mode (what Codex's `outputSchema` uses)
accepts only a schema in which every object lists ALL of its properties in
`required` and forbids extra keys. A product schema with an optional property
is rejected by the server (`invalid_json_schema`), so the adapter converts it
on the way out and converts the answer back on the way in:

out: an optional property becomes required and nullable;
in : a null for a property the product schema did not require is dropped,
so the product still validates the shape it defined.

Both walks are pure and cover nested objects, arrays and unions.
