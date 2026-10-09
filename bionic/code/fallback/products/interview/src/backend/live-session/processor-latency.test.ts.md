# products/interview/src/backend/live-session/processor-latency.test.ts

_Source: `products/interview/src/backend/live-session/processor-latency.test.ts` (header-comment fallback)_

Latency of the fast interpret-and-answer path over EVERY synthetic replay set
that has questions (recruiter screen, the grounding-hazard sets, the
engineering-manager set and the live-coding first draft), at real pacing (1x)
and at 4x (E-A2). The processor runs for real (ingest, replay, core, fenced
writes on a disposable PostgreSQL) against a fake engine; time is a virtual
clock so each set's own pacing and the settle window are exact without
waiting minutes. Two figures per question, p50 and p95 over every question
of a set and over every question of a speed, are recorded:
- paced: virtual time from the end of the utterance that triggered the
draft (the question, or the part-two follow-up that revised it) to the
draft (settle window + tick quantisation + the simulated model latency);
- processing: real wall-clock time the processor spent from that
utterance's ingest to the dispatch finishing (excludes the simulated
model).
A recruiter question arrives every 1-3 minutes and an answer window is 30-90
seconds, so the budgets below are ceilings far inside the window.

Coding latency is measured separately: time from the triggering utterance to
the solve-code result (a second action kind after the prose draft, with its
own simulated model and test-run time), and the prose draft must precede it.
