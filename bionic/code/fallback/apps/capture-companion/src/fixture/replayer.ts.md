# apps/capture-companion/src/fixture/replayer.ts

_Source: `apps/capture-companion/src/fixture/replayer.ts` (header-comment fallback)_

The fixture companion's replayer. It plays a synthetic, anonymised
recording (the shape the Interview product's replay sets already have)
through a Companion as if it were a live call. It is defined over plain data
so this app never imports a product: tests in the product pass the sets in.
