# products/presentation/src/export/index.ts

_Source: `products/presentation/src/export/index.ts` (header-comment fallback)_

pdf-lib's JPEG reader ignores byteOffset, so give it an unshared copy
(a small Buffer is a view into Node's shared pool).
