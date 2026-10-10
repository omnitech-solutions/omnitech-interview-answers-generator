# packages/interview-contracts/src/behaviour-flags.ts

_Source: `packages/interview-contracts/src/behaviour-flags.ts` (header-comment fallback)_

The product's behaviour flags: the switches a person may flip in Settings
instead of only through an environment variable. This one registry says, for
each flag, its environment name (which is also its key), its allowed values,
its default, which process reads it and the words shown for it. Validation,
the Studio's route, the worker's reading of it and the Settings pane are all
derived from here: adding a flag is adding a row (see
bionic/briefs/BRIEF-flags-in-settings.md).

[DOMAIN] Precedence, the same for every flag and in every process:
1. the environment variable, when the host set it (it wins, and Settings
shows the flag as set by the environment, read-only);
2. otherwise the value stored from Settings;
3. otherwise the host's default for it, where the flag names one
(`hostDefaultEnv`: what a launcher such as `pnpm dev` starts with);
4. otherwise the flag's own default.

[SAFETY] Only flags whose values are a closed list belong here. Nothing in
this registry is a secret, a URL, a path or a declaration about where a
model runs: those stay in the environment.
