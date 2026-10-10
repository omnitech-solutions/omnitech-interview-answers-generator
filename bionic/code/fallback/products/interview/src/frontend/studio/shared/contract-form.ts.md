# products/interview/src/frontend/studio/shared/contract-form.ts

_Source: `products/interview/src/frontend/studio/shared/contract-form.ts` (header-comment fallback)_

A form's JSON Schema, read from the contract that validates what the form
saves. A form is declared (a schema, a uiSchema and two value adapters) and
drawn by the library's DynamicForm; its field list is never written twice:
the contract's own object is the list, in the contract's own order.
