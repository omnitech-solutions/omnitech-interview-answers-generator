# Local presentation completion

## Work context

- Goal: make the outstanding Presentation Studio and supporting AI/agent changes usable in the existing local application.
- Scope: creation, editing, persistence, ordering, themes, image insertion, presentation mode, downloads, provider boundaries, worker failures, and verification. No deployment or push.
- Existing layers: Next.js delivery, Hono presentation API, presentation service/repository, PostgreSQL storage, AI gateway and isolated agent worker. All exist; the editor and export paths needed completion.
- Entities: presentation documents, slides, themes, generated images, shares, exports, recordings; tenant-owned PostgreSQL rows. AI job prompts/results use the existing encrypted payload store.
- Entrypoints: `products/presentation/src/frontend/index.tsx`, `products/presentation/src/backend/api.ts`, `apps/web/src/platform/ai.ts`, `apps/agent-worker/src/index.ts`.
- Boundaries: authenticated tenant resolution for normal routes; hashed, revocable tokens for shared reads; local deterministic provider for this demonstration; no hosted model calls during verification.
- Architecture decisions: reuse the current services and database. Share the slide parser between rendering and exports. No new package or service.

## Corrections and decisions

- Give slide content an explicit readable foreground and synchronize the block editor when tools or undo change the same slide source.
- Preserve image positions in the source parser. Regression test first failed with `expected ['H1', 'P', 'IMG'] to deeply equal ['H1', 'IMG', 'P']`.
- Implement source undo/redo, dirty-slide tracking and an export guard for unsaved content. Place the edit form next to the selected slide.
- Vacate existing slide positions before assigning a new order, preserving the immediate `(document_id, position)` uniqueness constraint. Refresh the document revision after reorder/delete.
- Expose generation and agent controls from active markup instead of retaining an inactive legacy editor. Insert existing uploaded images through the media panel.
- Label deterministic local drafts explicitly. Respect requested slide count and keep generation instructions out of outline content. Language selectors contain language targets only.
- Pass tone, audience, scenario and density to outline generation. Apply theme colors and presentation font/alignment settings to preview, presentation mode and exports.
- Wire library sorting/list views and panel search. Offer the implemented bar chart and process-flow cards; remove choices that merely inserted unrelated placeholder content.
- Export heading/body/image blocks rather than flattening the whole slide into one string. Preserve selected colors; support inline PNG/JPEG images. Fail clearly on oversized content, remote images or PDF text outside the supported Latin font.
- Accept inline PNG/JPEG/WebP provider output. The new OpenAI inline-image regression first failed with `Image providers must return an HTTP(S) URL.` Remote loopback rejection remains tested. Correct the deterministic image MIME type to SVG.
- Mark worker execution exceptions as failed instead of terminating the worker with a job left running. Do not publish a completed result after cancellation is observed.
- Use Testing Library `fireEvent.click` for the inspector helper, keeping the same visibility assertion and requiring the control to exist. The old optional DOM click failed with `Unable to find role="dialog" and name "Inspector"`. Full 119-test product workload measured 4.62 seconds before and 4.80 seconds after on this machine; no timeout or retry budget was changed.

## Verification

- `pnpm verify`: lint, format, typecheck, coverage and build passed. Coverage run: 45 test files, 291 tests passed. Build: 30 successful tasks. Log: `/tmp/omnitech-finish-verify-final.log`.
- `pnpm test`: all 76 tasks successful. Log: `/tmp/omnitech-finish-all-tests.log`.
- `pnpm rulesync:verify`: `.codex verified: 10 commands, 17 skills`. Log: `/tmp/omnitech-rulesync-verify.log`.
- Presentation package tests: 6 files, 13 tests passed, including downloadable PPTX/PDF artifacts. React block-editor synchronization test also passed in the root React project.
- Local PostgreSQL integration: `DATABASE_URL=<existing local database> pnpm exec tsx products/presentation/integration/repository.ts`. Create, save, both reorder directions, rename, delete/renumber, tenant isolation, share and revoke passed. All integration fixtures were rolled back.
- Chrome demonstration: created a ten-slide local draft, edited the first slide, used undo/redo, saved, reordered in both directions, renamed, reloaded, exported both formats, and navigated next/previous in presentation mode.
- Downloaded PDF inspected with `pdf-lib`: 10 wide pages and correct document title. Downloaded PPTX inspected with `jszip`: 10 slides and saved content in `ppt/slides/slide1.xml`.
- Live demonstration document: `75ac7b46-15d3-4b10-a7ae-b1750253a058`. Files: `~/Downloads/Community garden launch — local demo.pdf` and `.pptx`. Screenshot: `/tmp/omnitech-finished-presentation.png`.
- The repository launcher was restarted to load final worker code; web, terminal gateway and worker remain running. The presentation is left open in the operator's Chrome session.

## Not done and limits

- Hosted providers and authenticated Codex/Claude execution were tested through contracts and mocks, not real paid/provider calls. Screen recording was not exercised because it requires the operator's screen/media permission.
- Local generation is a deterministic outline/slide draft builder, not a language model; the demonstration deck has one manually completed slide and nine outline slides.
- PDF uses the existing Latin font. Other scripts/emoji require PPTX. Exports represent chart/diagram/infographic data as readable text rather than pixel-identical rendered graphics. Remote/SVG image exports fail clearly; upload PNG/JPEG for media export.
- No push or deployment. Export and worker units are committed; remaining presentation/platform and local auth/launcher changes are uncommitted pending the credential-file permission requested under AGENTS.md.


## Regression tests and commits

- Added five regression cases: cancellation during completion, runtime exception sanitization and workspace cleanup, non-Latin PDF failure with Unicode preserved in PPTX, and overflow rejection in both download formats.
- The first Japanese-heading PDF test failed: expected `Use PPTX`, received `WinAnsi cannot encode "こ" (0x3053)`. Fixed first-word validation by measuring its font width before the wrapping condition.
- Temporarily changed the worker cancellation comparison in the actual source consumed by its tests. The cancellation regression failed (one failed, four passed); restored the exact source, re-read it, and all five worker tests passed.
- Fresh `pnpm verify` exited zero: 45 coverage files, 291 tests, and 30 build tasks passed. Log: `/tmp/omnitech-commit-verify.log`.
- Fresh `pnpm test` exited zero: all 76 workspace tasks successful. Presentation package: 16 tests; worker package: five tests. Log: `/tmp/omnitech-commit-tests.log`.
- `pnpm rulesync:verify` passed: 10 commands, 17 skills. Pre-commit lint, format and rulesync also passed.
- Commit `6ae599b`: block-based exports, appearance/parser domain modules, dependency declarations and six export tests.
- Worker lifecycle commit: resumed output schemas/results, cancellation, failures and five tests. No push.
- Remaining full-batch commit is awaiting explicit permission for files with development credential defaults and auth changes; no credential was changed during this test-completion task.
