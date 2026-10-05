# products/interview/src/frontend/studio/live/overlay/dictation.ts

_Source: `products/interview/src/frontend/studio/live/overlay/dictation.ts` (header-comment fallback)_

Browser dictation: the Web Speech API's SpeechRecognition (the webkit prefix
is fine). Continuous, with interim results shown as they come; each FINAL
phrase is handed to the caller, which appends it to the follow-up input. It is
never sent by itself.

[SAFETY] In a device-only session the recognition must run on this device
(`processLocally`): a browser that cannot do that refuses, with a message,
rather than sending audio to a speech service. In a remote session Chrome may
use its own speech service, which the tooltip says.
