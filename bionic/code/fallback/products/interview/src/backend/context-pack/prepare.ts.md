# products/interview/src/backend/context-pack/prepare.ts

_Source: `products/interview/src/backend/context-pack/prepare.ts` (header-comment fallback)_

An application's context pack, PREPARED BY A MODEL and kept (ADR-0041).

PROBLEM: the posting, the research, what the employer said and each stage's
transcript are prose. Turning them into facts a reader can lean on needs a
model, of any size, and nothing a model writes may be kept unless the
source says it. STRATEGY: the engine does the work (it cuts each source to
the model's window, asks, looks for every quote in the source, merges, ties
records together and keeps the result under a name); this file says WHAT is
prepared (every part of the application, all stages), in what ORDER (a few
sources at a time, so a person sees how far it is and stopping loses
nothing already read), under which NAME (one pack per application and
member), and what the person is SHOWN of the result (the review).
It is the only place the product asks a model to prepare a pack: every
reader takes what is kept here and asks no model (kept.ts, pack.ts).
COMPLEXITY: one engine call per group of sources read; inside it, one model
call per piece of a source and per batch of ties.
