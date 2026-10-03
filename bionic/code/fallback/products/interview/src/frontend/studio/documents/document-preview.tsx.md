# products/interview/src/frontend/studio/documents/document-preview.tsx

_Source: `products/interview/src/frontend/studio/documents/document-preview.tsx` (header-comment fallback)_

The frame holds a document the member uploaded, so it is inert: no scripts
(the sandbox omits allow-scripts) and no network (the policy). The parent
renders into it, which is why it needs the same origin.
