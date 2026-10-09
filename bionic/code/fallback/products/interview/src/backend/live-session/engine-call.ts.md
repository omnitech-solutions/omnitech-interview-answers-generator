# products/interview/src/backend/live-session/engine-call.ts

_Source: `products/interview/src/backend/live-session/engine-call.ts` (header-comment fallback)_

What a session asks of the AI engine, and how it asks (ADR-0037).

PROBLEM: the processor must make model calls without knowing a provider, a
model or a runtime, and every call must carry who the session's owner is,
where it may be processed and which answer it belongs to. STRATEGY: one call
shape in the session's own words, and one function that puts it to the
engine and reads the answer back. The engine is handed in by the host; the
processor names profiles and nothing else (rule:model-calls-gateway-routed).
