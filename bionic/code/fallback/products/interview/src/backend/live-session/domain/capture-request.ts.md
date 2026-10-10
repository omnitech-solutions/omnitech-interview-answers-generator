# products/interview/src/backend/live-session/domain/capture-request.ts

_Source: `products/interview/src/backend/live-session/domain/capture-request.ts` (header-comment fallback)_

The capture request as stored on its session row, and the decisions made
from it. Pure: the stored value and the database clock come in, a decision
goes out (capture-request.ts and the ingest handlers persist it).
