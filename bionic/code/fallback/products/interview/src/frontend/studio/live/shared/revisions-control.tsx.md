# products/interview/src/frontend/studio/live/shared/revisions-control.tsx

_Source: `products/interview/src/frontend/studio/live/shared/revisions-control.tsx` (header-comment fallback)_

The Revisions control: a button naming the revision on show ("rev 2 of 3")
and a popover list of every revision, newest first, the current one marked.
One component and one list for the native window and the web page; each
surface passes a variant (its class names) and what choosing does.
Choosing is view-only: it changes which revision is shown, never the task.
