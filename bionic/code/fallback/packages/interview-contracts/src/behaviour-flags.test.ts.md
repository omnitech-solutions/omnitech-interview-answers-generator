# packages/interview-contracts/src/behaviour-flags.test.ts

_Source: `packages/interview-contracts/src/behaviour-flags.test.ts` (header-comment fallback)_

The behaviour flag registry: every flag is a closed list with a default in
it, the environment wins over what Settings stored, what Settings stored
wins over the defaults, and each flag's reading of its environment variable
is exactly what the code read before the flag could be stored.
