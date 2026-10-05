# products/interview/src/frontend/studio/live/shared/screenshots-area.tsx

_Source: `products/interview/src/frontend/studio/live/shared/screenshots-area.tsx` (header-comment fallback)_

The Screenshots icon (with its count) and the area it opens under the task
line, for the native answer pane and the web task panel alike. One model
(use-screenshots-view.ts), one set of parts; a variant only picks class names.

Auto:   a minimised, horizontally scrolling strip of the task's stored
screenshots, closed until the icon is pressed (open once something
is staged).
Manual: the same area is the STAGING TRAY, open by default: capture stages
on the device ("Not sent yet"), each image can be cropped, removed
and reordered, and ONE Apply makes the request.
