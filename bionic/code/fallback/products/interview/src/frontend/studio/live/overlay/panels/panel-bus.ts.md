# products/interview/src/frontend/studio/live/overlay/panels/panel-bus.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/panel-bus.ts` (header-comment fallback)_

Panels are separate documents (separate native windows). The server is the
authority for the session; this channel only carries what exists in one
document's memory: the owner's live mic/Auto state, typed lines and requests
from a panel that does not own the microphone. Settings, the capture region
and the Auto preference travel through localStorage (the `storage` event).
Nothing here is persisted; no session content leaves the origin.
