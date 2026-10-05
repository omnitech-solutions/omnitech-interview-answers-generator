# products/interview/src/frontend/studio/live/overlay/panels/single-panel.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/single-panel.tsx` (header-comment fallback)_

The minimized view: the toolbar, the status strip, the chat, the answer and
the code in ONE window the person can move and resize. The toolbar is the
pivot: it stays at the centre, and showing or hiding a pane widens or narrows
the window evenly around it. Which panes exist, how wide each is, and which
footer buttons show are tables in toolbar-config.ts; this file only draws
them. The footer keeps the honest "Visible window" note and the build id.
