---
name: planning
description: Turn an audited feature request into an implementation-ready Omnitech platform blueprint.
---

# Planning

Use the codebase audit and simplicity gate. Produce one chosen design, not a
menu of unresolved alternatives. The blueprint must give another engineer every
architecture decision needed to implement it.

For platform work, explicitly define:

- product manifest, frontend loader, backend router, permissions, installation
  configuration, and failure isolation;
- tenant resolution and authorization order;
- platform-schema versus product-schema ownership;
- typed request, response, event, and repository interfaces;
- global shell state and product-local state;
- OAuth login versus connected-account grants;
- migration, rollback, observability, security, and operational runbooks;
- reviewable milestone commits and exact verification gates.

Use Mermaid for architecture and major stateful flows. Include success and
failure paths. Reference real files. Keep code sketches limited to interfaces
and boundary behavior required to remove ambiguity.
