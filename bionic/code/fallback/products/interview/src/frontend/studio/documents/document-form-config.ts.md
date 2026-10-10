# products/interview/src/frontend/studio/documents/document-form-config.ts

_Source: `products/interview/src/frontend/studio/documents/document-form-config.ts` (header-comment fallback)_

PROBLEM: the editor drew every field by hand and kept its own layout.
STRATEGY: the template's fields are the only description of the form. This
module turns them into what the library's DynamicForm reads (a JSON schema
and a uiSchema) and maps the stored flat values to the form's grouped ones
and back. It is pure: no React, no requests, no state.
COMPLEXITY: O(fields) for the configuration and for either projection.
