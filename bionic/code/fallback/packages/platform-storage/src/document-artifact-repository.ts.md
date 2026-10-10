# packages/platform-storage/src/document-artifact-repository.ts

_Source: `packages/platform-storage/src/document-artifact-repository.ts` (header-comment fallback)_

Platform storage owns bytes and metadata. The caller must first resolve the
template revision or export under Interview's actor-scoped repository; an
arbitrary artifact ID from a request is not proof of that relationship.
What may be stored is decided in ./document-artifact-rules; this class only
persists, in the caller's transaction or in one of its own.
