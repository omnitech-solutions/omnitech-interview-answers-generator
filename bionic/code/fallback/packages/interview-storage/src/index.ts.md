# packages/interview-storage/src/index.ts

_Source: `packages/interview-storage/src/index.ts` (header-comment fallback)_

[STRATEGY] The library file can hold whole documentation sets (tens of
megabytes). A read-only call reuses the parsed file while the file on
disk is unchanged (same modification time and size); every write goes
through a rename, which changes both. A method that changes the file
reads it fresh, so the shared copy is never mutated.
