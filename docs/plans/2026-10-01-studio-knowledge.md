# Interview Studio Knowledge (redesign sub-project 5 of 6)

Status: implemented 2026-10-01 on `master`, under the operator's authorisation to implement the redesign end to end.

## Outcome

Knowledge (`/t/local/p/interview/knowledge[/…]`) uses the design's layout while reusing the existing Library, its API and its data:

- **Top:** a full-width search box with a `/` hint, and the technology chips (All, TypeScript, PHP, React, Laravel, Symfony).
- **Left:** the filters, which **stay put while searching**: content type with counts, collections, "Official only" and popular tags. While searching, a "Clear search and filters" link appears above them.
- **Main column while searching:** "N results" and result cards, each with:
  - a breadcrumb (collection › section)
  - the title
  - an **Official** badge and a type pill
  - the excerpt with the match highlighted
- **Nothing matches:** "Nothing matches "q"" with **Clear search**.
- **Opening a card:** the article opens in the main column, under the studio path (`/knowledge/<slug>?q=…`), with "← Back to results" (or "← Back to Knowledge"). The table of contents shows only when an article is open.

## Design

- **Embedded mode only.** These are additions to `Library`'s `chrome="embedded"` mode. Standalone mode, which `apps/web` uses, keeps its search-index sidebar and has its own tests.
- **New component.** `ResultCards` is new in `library.tsx`. The `searching`, `clearSearch` and `closeArticle` helpers are shared by both modes.
- **Styles.** `studio/knowledge.css` holds the styles, scoped to `.studio-view` so they apply only inside the studio.

## Verification

- `pnpm verify` passed: 562 tests; coverage 91.24% statements, 82.65% branches, 91.16% functions.
- **New tests:**
  - result cards beside the filters, with no Library chrome in the studio
  - ⌘K left to the palette while `/` still focuses search
  - an article opens under the studio path, and Back returns to the results
  - the "nothing matches" state and Clear search
  - clearing from the sidebar
- **Browser:** the cards for "optimistic" matched the design; opening a card and going back kept the search; a full-width search; the empty state and its Clear search.
