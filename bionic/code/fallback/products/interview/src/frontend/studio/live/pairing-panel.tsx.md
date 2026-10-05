# products/interview/src/frontend/studio/live/pairing-panel.tsx

_Source: `products/interview/src/frontend/studio/live/pairing-panel.tsx` (header-comment fallback)_

Pairing the capture companion with the open session: the credential controls
that sit INSIDE the one companion block of the Sources tab (sources-tab.tsx
owns its title, its status and its credential line; this adds none of them). The one-time credential
(from start or renewal) is shown here, masked until the owner reveals it,
and lives only in the session store's `pairing` field: this component never
writes it to storage, a URL or a log (rule:credential-storage). Dismissing
clears it. Mounted by the live view (and its Sources tab); renders nothing
when no session is open.
