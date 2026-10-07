# products/interview/src/frontend/studio/live/overlay/panels/panel-views.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/panel-views.tsx` (header-comment fallback)_

The panes beside the toolbar: the analysis (the answer pane and the code
pane, in answer-pane.tsx), the transcript and chat (chat-panel.tsx), settings
and the toasts. Each takes the one panel session (usePanelSession) and renders it;
none fetches or decides anything itself.

[SAFETY] The settings footer says plainly that this is a visible window that
shows in screen shares. Nothing here hides a window or conceals capture.
