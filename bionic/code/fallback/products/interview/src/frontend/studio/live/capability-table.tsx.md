# products/interview/src/frontend/studio/live/capability-table.tsx

_Source: `products/interview/src/frontend/studio/live/capability-table.tsx` (header-comment fallback)_

What runs where, for this session's processing policy. Only rows the
architecture supports are listed:
Speech         the companion transcribes with the OS's on-device
recognition (ADR-0012 "Locality by stage"), in both
policies; the row says "On this Mac, in the companion" only
when the companion's last report says on-device recognition
is available, and otherwise the true state
Screenshots    stored for the owner. Only when the owner presses Analyze
is a capture sent, to the selected vision-capable model
(ADR-0016); device-only refuses it and never sends one
Answer drafts  device-only: the on-device model (text-only); remote: the
gateway (ADR-0012/device-only-enforced-twice)
Coding drafts  device-only: refused, coding inference needs a remote model
Raw audio      only in the companion's bounded memory, never sent, stored
or logged (ADR-0012/raw-audio-never-persisted)
