# products/interview/src/backend/api.ts

_Source: `products/interview/src/backend/api.ts` (header-comment fallback)_

Request bounds. The JSON bound covers every route; the code-execution routes
(/run, /run-all, /syntax-check, /react-preview) hand the body to a container
or the bundler, so they take a tighter body and per-field caps.
