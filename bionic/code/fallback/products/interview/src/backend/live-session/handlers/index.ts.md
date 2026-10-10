# products/interview/src/backend/live-session/handlers/index.ts

_Source: `products/interview/src/backend/live-session/handlers/index.ts` (header-comment fallback)_

Which handler takes a message: a table keyed on the kind the envelope names.
A new content-free kind is a new row. Anything the table does not name (an
observation kind, an unknown kind, no kind at all) is an observation, whose
own validation answers it.
