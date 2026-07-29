---
targets: ["*"]
description: Repository operating map
---

# Repository operating map

Read rules in this order:

1. `base.md` for the engineering contract.
2. `simplicity-first.md` before architecture or planning work.
3. `packages.md` before changing a package boundary.
4. `platform-architecture.md` before changing products, tenancy, auth, APIs,
   storage, navigation, or global UI state.

Use `codebase-audit` before planning and `planning` to produce a
decision-complete blueprint. `.rulesync/**` remains the only editable source for
rules, commands, and skills.
