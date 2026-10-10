# products/interview/src/frontend/studio/documents/use-document-editor.ts

_Source: `products/interview/src/frontend/studio/documents/use-document-editor.ts` (header-comment fallback)_

The editor's one controller. Server state (the revision, its fields, the
exports) is read from the server and never edited here; the draft (unsaved
values, the field in hand) is the local copy; what is open or hidden is
presentation. Every request the editor makes starts in this file.
