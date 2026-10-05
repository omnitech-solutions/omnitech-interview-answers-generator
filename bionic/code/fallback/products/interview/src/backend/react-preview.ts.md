# products/interview/src/backend/react-preview.ts

_Source: `products/interview/src/backend/react-preview.ts` (header-comment fallback)_

The preview bundles the caller's code, so the caller must not be able to
make the bundler read the host: only these bare packages resolve from the
entry, everything else (relative, absolute, file:, other packages) is refused.
