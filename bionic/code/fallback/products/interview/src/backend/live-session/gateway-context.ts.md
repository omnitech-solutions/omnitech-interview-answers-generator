# products/interview/src/backend/live-session/gateway-context.ts

_Source: `products/interview/src/backend/live-session/gateway-context.ts` (header-comment fallback)_

The access context a session's gateway calls carry: the product, the session
OWNER as the user and the product's read permission. Tenant and user come
from the claimed session row, never from ingest or model content. The host's
gateway authorizes by these permissions, as it does for every product call.
