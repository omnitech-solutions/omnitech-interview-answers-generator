# Interview Library

## Purpose

Interview Library is a local-first, DevDocs-style reference workspace for
finding concise, reviewed interview material without leaving Interview Studio.
It prioritizes provenance, lexical accuracy, keyboard speed, and consistent
rendering. It does not scrape or reproduce third-party documentation.

## Primary journeys

1. Press `Cmd/Ctrl+K` or `/`, search a technical term, filter by content type or
   tag, and open the exact matching section.
2. Browse an interview-focused collection, read a concise article, follow its table
   of contents, and open the canonical source when more detail is needed.
3. Add an item, preview its Markdown, save it as a draft, then publish it only
   after provenance and taxonomy validation succeeds.
4. Edit, archive, or remove draft material while keeping search results limited
   to the current published corpus.

## Content taxonomy and trust

Content types are `official-reference`, `cheat-sheet`, `concept-guide`, and
`dsa-pattern`.

- Official references require an HTTPS URL, exact document title, publisher,
  version when available, verification date, and canonical source link.
- Cheat sheets are compact Interview Studio-owned recall material.
- Concept guides are spoken-friendly explanations and trade-offs.
- DSA patterns contain recognition cues, invariants, complexity, and an
  implementation template.

Every item has one collection and at least one normalized tag. Tags are
lowercase slugs. Drafts and archived items are never searchable.

## Data model

`LibraryItem` contains:

- UUID `id`, unique `slug`, `title`, `summary`, and Markdown `body`;
- `contentType`, `collection`, normalized `tags`, and `status`;
- optional `source` with publisher, canonical URL, official flag, version, and
  last-verified date;
- `createdAt`, `updatedAt`, optional `publishedAt`, and monotonic `revision`.

Published Markdown is authoritative. The search index is derived, disposable,
and identified by a source revision digest.

## Search and indexing

Markdown is split into heading-based sections. Each indexed record retains the
document ID and slug, stable GitHub-style anchor, heading hierarchy, metadata,
and plain section text.

Ranking order is:

1. exact document title;
2. section heading;
3. tags;
4. summary;
5. publisher;
6. section body.

Short technical queries remain exact. Typo tolerance is enabled only for terms
of five or more characters. Results return a bounded highlighted excerpt and
link directly to `/library/:slug#:section`.

The search engine is accessed through a provider-neutral
`LibrarySearchIndex`. The initial adapter uses Orama. A future lexical/vector
hybrid can implement the same interface; v1 contains no embeddings or vector
schema.

The persisted index loads once per server process. A missing, corrupt, or stale
index is rebuilt from published records before search results are served.

## HTTP interface

- `GET /api/v1/library/search`
- `GET /api/v1/library/facets`
- `GET /api/v1/library/items`
- `GET /api/v1/library/items/:idOrSlug`
- `POST /api/v1/library/items`
- `PUT /api/v1/library/items/:id`
- `POST /api/v1/library/items/:id/publish`
- `POST /api/v1/library/items/:id/archive`
- `DELETE /api/v1/library/items/:id` for drafts only

Existing same-origin and bearer-token protections apply. Structured errors use
the existing API error envelope. Search text and authored content are not
logged.

## Page and keyboard design

`/library` is a real route. `/library/:slug` deep-links an article, and heading
fragments deep-link sections.

Desktop uses three panes:

- collections, content types, official-only filter, and tags on the left;
- provenance, article content, and previous/next links in the center;
- a sticky on-page table of contents on the right.

Side panes collapse on narrow screens. Search is sticky and supports:

- `/` or `Cmd/Ctrl+K` to focus;
- arrow keys to move through results;
- Enter to open;
- Escape to close or clear.

The authoring surface provides metadata inputs, normalized tags, a Markdown
editor, live preview, save draft, publish, archive, and delete-draft actions.

## Rendering

Concept Lab and Library share one safe Markdown pipeline:

- CommonMark and GFM;
- stable linked headings;
- Shiki light/dark syntax highlighting, copy controls, language labels, and
  line focus/diff annotations;
- the existing interactive Mermaid renderer;
- styled tables, lists, callouts, and external links.

Raw HTML remains disabled.

## Failure boundaries

- Invalid publication leaves the current published revision unchanged.
- Duplicate slugs return a conflict.
- A stale index rebuilds before serving results.
- An unrecoverable rebuild returns `library_index_unavailable`; stale or partial
  results are not served.
- Only drafts can be permanently deleted. Published content must be archived.

## Acceptance criteria

- Exact-title and heading matches outrank body-only matches.
- Filters compose and facets reflect the published corpus.
- Publishing, editing, and archiving are reflected by the next search.
- The initial corpus contains 54 reviewed interview-focused items, including a
  React 19.2 collection organized around the official Learn and Reference
  documentation categories used by DevDocs.
- Keyboard search, deep links, provenance, responsive panes, authoring, GFM,
  Shiki, and Mermaid are covered by tests.
- A deterministic 10,000-section benchmark reports warm-search p95 and index
  restoration time without imposing a wall-clock unit-test gate.
- `pnpm rulesync:verify` and `pnpm verify` pass.
