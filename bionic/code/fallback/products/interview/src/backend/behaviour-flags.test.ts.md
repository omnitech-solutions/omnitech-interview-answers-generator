# products/interview/src/backend/behaviour-flags.test.ts

_Source: `products/interview/src/backend/behaviour-flags.test.ts` (header-comment fallback)_

What Settings stored for the behaviour flags, kept in one file: what is set
is what is read, here and by a new instance over the same file; only a
flag's own values are ever kept; the environment wins and cannot be
overwritten; and a file that cannot be written still leaves the value held
for this process. Every file is under a temporary directory, never the data
directory.
