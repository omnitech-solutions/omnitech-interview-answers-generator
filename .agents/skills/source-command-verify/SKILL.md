---
name: "source-command-verify"
description: "Run the complete repository verification gate"
---

# source-command-verify

Use this skill when the user asks to run the migrated source command `verify`.

## Command Template

# Verify

Run `pnpm verify`. Fix failures at their source and rerun the smallest relevant
check, then rerun the full verification command. Report the exact commands and
results.
