# products/interview/src/backend/documents/built-in-assets.ts

_Source: `products/interview/src/backend/documents/built-in-assets.ts` (header-comment fallback)_

[SAFETY] One literal URL per committed stand-in file. A bundler (Next's
Turbopack) resolves each `new URL("./assets/<name>", import.meta.url)` to its
own emitted file; a path built from a variable ("./assets/${name}") collapsed to
a single file in the production bundle, so every built-in template read the
same bytes and the markdown one was refused ("Markdown must be UTF-8"), which
broke the Documents page. Keep this table literal and in step with
`builtInTemplates()` (built-in-assets.test.ts checks it).
