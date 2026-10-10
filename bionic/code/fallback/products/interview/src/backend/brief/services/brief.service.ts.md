# products/interview/src/backend/brief/services/brief.service.ts

_Source: `products/interview/src/backend/brief/services/brief.service.ts` (header-comment fallback)_

The interview brief's use cases. Each opens ONE tenant transaction in the
member's own scope and lets the repository settle ownership first; a
refusal is a `BriefError` code. The routes parse and map; nothing here
knows HTTP.
