---
targets: ["*"]
description: Mandatory simplicity gate for architecture choices
---

# Simplicity gate

For non-trivial architecture work, compare three bounded options:

1. Small: existing runtime, database, and deployment unit.
2. Intermediate: one new package boundary or lifecycle seam.
3. Distributed: independent deployment or infrastructure.

Choose the smallest option satisfying current requirements. A distributed
option requires a demonstrated isolation, scaling, ownership, security, or
release need. Estimate changed lines and operational components. If the choice
adds infrastructure or exceeds 1,000 changed lines, surface a scope checkpoint
before implementation unless the user explicitly authorized the full change.

Do not create a provider interface, event bus, remote module loader, or service
boundary for a hypothetical implementation. Do define a narrow boundary when a
second implementation exists or a lifecycle is already independent.
