# apps/capture-companion/src/corpus.test.ts

_Source: `apps/capture-companion/src/corpus.test.ts` (header-comment fallback)_

The shared wire corpus is the contract between companions and Studio. Every
valid message this companion can emit must be reproduced by its builders,
and every invalid message must be refused by its own pre-send validation.
