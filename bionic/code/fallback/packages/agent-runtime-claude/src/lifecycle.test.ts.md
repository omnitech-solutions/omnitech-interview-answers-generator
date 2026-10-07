# packages/agent-runtime-claude/src/lifecycle.test.ts

_Source: `packages/agent-runtime-claude/src/lifecycle.test.ts` (header-comment fallback)_

A Claude CLI process must never outlive the run it was started for. These
tests drive the two ways one used to: a run cancelled after its CLI stopped
answering (interrupt() never settles), and an idle pooled session that nothing
closed once the worker went quiet.
