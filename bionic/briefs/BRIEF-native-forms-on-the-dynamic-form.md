---
title: "The native app's forms on the dynamic form: inventory, what was replaced, what waits"
slug: native-forms-on-the-dynamic-form
type: brief
status: draft
created_at: 2026-10-10
updated_at: 2026-10-10
authors: ["desoleary", "claude"]
tags: [ui-library, native, studio, dynamic-form, forms, contracts, inventory]
related_adrs: [ADR-0002, ADR-0003, ADR-0033, ADR-0042]
---

# The native app's forms on the dynamic form

## Problem

The owner asked for an inventory of the places in the native app where the library's
`DynamicForm` would be preferable, and for the hand-built forms ("like the company context one")
to be replaced with it. The rule it serves: a form is declared, not hand-built; configuration
represents variation (`bionic/research/references/application-boundaries.md`, ADR-0042). Until
today `DynamicForm` was used nowhere in this repository
(`BRIEF-web-app-on-the-ui-library-only.md`).

This brief is the inventory, the record of the first two replacements, and the precise list of
what the library must give before the rest can follow.

## In short

| Verdict | Forms |
|---|---|
| Replaced today | 3: the interview context form (company, role, notes, job spec), Settings › Behaviour, and "Employer said" add-entry |
| DynamicForm now (not yet done) | 1: the pack review's edit-a-fact |
| DynamicForm once the library has a named thing | 9 (table below, each with what it waits for) |
| Leave as is | 14 single controls (a toggle, a picker, a search box, a chat box) |

Three findings the owner should know:

1. **A `DynamicForm` that fails validation once can never be submitted again** in the vendored
   library (request L1). The context form is therefore gated the way it was (Save cannot be
   pressed until the contract accepts what is typed), with the gate now read from the contract.
2. **Two `DynamicForm`s on one screen share element ids** (`root_<field>`), so a second form with
   a field of the same name breaks labels (request L2). This is what holds back the stage forms
   and Research, which sit in the same dialog as the context form.
3. **The context form's field list now exists once**, in
   `candidacyContextInputSchema` (`packages/interview-contracts/src/live-session.ts`). Reshaping
   it towards the context pack's records is a change to that object plus words.

## How a form is declared here

| Part | Where | Rule |
|---|---|---|
| Field list, order, bounds, required | the zod contract | never repeated in the frontend |
| JSON Schema | `contractFormSchema(contract, fields?)` in `studio/shared/contract-form.ts` | one pure function: `z.toJSONSchema` on the contract's input side, draft 7; a field not in the contract throws |
| Words, widget, rows | a `*-form.ts` beside the screen | data; the widget and the row follow the contract's bound (a text bounded above 1,000 characters is a text area on its own row) |
| Values in, values out | two pure adapters in the same file, with round-trip tests | the way out parses with the contract, because the library hands `onSubmit` the raw values (request L3) |
| Authority | the server's own parse of the same contract | the form's check only decides what can be pressed |

For a registry (the behaviour flags) the registry is the contract: schema, parser, uiSchema and
values are each one pure function of `BEHAVIOUR_FLAGS`.

## Inventory: the native window

Sources: `products/interview/src/frontend/studio/live/overlay/**` and
`studio/interview-brief/**`. "Library fields" means controlled `Input`, `Select`, `Textarea` from
the library held in `useState`.

| # | Form or group | File | Fields | Validated / saved | Built from | Verdict |
|---|---|---|---|---|---|---|
| 1 | Interview context | `live/overlay/panels/interview-context-modal.tsx` | company, role, notes, job spec | contract gate; POST `/candidacies` then PATCH `…/context`; "Clean up" POSTs `…/brief` | was library fields in a `div` | **Replaced** |
| 2 | Settings › Behaviour | `panels/behaviour-flags-setting.tsx` | one choice per registry row | registry values; PUT `/api/v1/behaviour-flags` on change | was a `Select` per row | **Replaced** |
| 3 | Employer said: add an entry | `interview-brief/brief-lists.tsx` | what was said, who, how, when | `said` not blank; `employerSaidInputSchema`; POST via `interviewBriefClient` | was library fields | **Replaced** ("Not said" is an empty choice in the form, an absent field in what is saved) |
| 4 | Pack review: edit a fact | `interview-brief/pack-review.tsx` | one text | not blank, bounded; POST `…/context-pack/corrections` | library `Textarea` | **Now**, but one field: low value until the pack's record form (below) |
| 5 | Stage (one per stage) | `interview-brief/interview-brief-form.tsx` `StageSection` | stage, kind, status, when, minutes, format, people[] (name, title, role), notes, outcome, next | `stageUpdateSchema`; PUT on Save | library fields | **Waits**: L2 (ids), L4 (array rows from library parts), L5 (date-time that can be empty), L6 (dense size) |
| 6 | Another stage | same, bottom of Stages | label, kind | `stageCreateSchema`; POST | library fields | **Waits**: L2 (`root_label`, `root_kind` repeat per stage) |
| 7 | Research: add a document | `brief-lists.tsx` `ResearchList` | title, link, text, file | `researchCreateSchema`; POST, upload | library fields | **Waits**: L2 (`root_title` is the context form's Role), L7 (real file values) |
| 8 | Transcript: paste or upload | `interview-brief-form.tsx` `Transcripts` | text, policy, file | `transcriptPasteSchema`; POST, upload | library fields | **Waits**: L7, L2 |
| 9 | Experience role editor | `panels/context-pane.tsx` | summary, achievements, technologies (one per line) | saved as a new matrix revision | library `Textarea` in `Descriptions` | **Waits**: L6, and a `tags`-as-lines option (L8) |
| 10 | Notes for this interview | `panels/context-pane.tsx` | one text | PATCH `…/context` | library `Textarea` | **Leave**: one field; the same data as form 1 |
| 11 | Settings: coding language, active skill | `panels/panel-views.tsx` | 2 raw `<select>` | preferences, on change | **raw `select`, `pn-select` CSS** | **Waits**: a disabled option with a reason in `select` (L9); then one form with #2 |
| 12 | Settings: call audio | `panels/call-audio-setting.tsx` | 1 select | preference | library `Select` | **Waits** with #11 (one settings form) |
| 13 | Start: session for, agreement | `panels/start-panel.tsx` | select, checkbox | starts a session | library fields | **Leave**: a picker and a consent tick beside a Start button, not a record |
| 14 | Context pane pickers (revision, projection, stage) | `panels/context-pane.tsx` | 3 selects | act at once | library `Select` | **Leave**: filters |
| 15 | Transcript policy per row | `interview-brief-form.tsx` | 1 select | PATCH on change | library `Select` | **Leave**: inline edit of one value |
| 16 | Chat message, coach-notes search, missing context | `chat-panel.tsx`, `coach-notes.tsx`, `live/shared/missing-context-strip.tsx` | one box each | send / filter | library `Input`, `Textarea` | **Leave**: a message box and a search box are not forms |
| 17 | Layout, dock, notes size, language for Regenerate | `coach-layout.tsx`, `coach-notes.tsx`, `answer-pane.tsx` | segmented, menus | preference | library parts | **Leave**: single controls |
| 18 | Screenshot send choice, crop edges | `live/shared/screenshot-send-control.tsx`, `crop-editor.tsx` | radio, range | per capture | raw inputs | **Leave** as forms; they are raw inputs to move to library parts (web brief) |

## Inventory: the Studio's web pages (same folder, not the native window)

Listed because they live under `studio/**`; the page-by-page plan is in
`BRIEF-web-app-on-the-ui-library-only.md`.

| Form | File | Fields | Verdict |
|---|---|---|---|
| Interview card | `home/interview-card.tsx` | company, role, when, minutes, format, topics (raw `<form>`, 6 raw inputs) | **Waits**: L5; otherwise the best next proof |
| Behavioural setup | `briefings/behavioural/setup-card.tsx` | role, posting, employer said, research | **Waits**: L2, L6 |
| Matrix import | `briefings/behavioural/matrix-picker.tsx` | file, JSON text, checkbox | **Waits**: L7 |
| New question | `workspace/new-question.tsx` | question, language | Now, once its page moves to library layout |
| Rehearsal set-up | `rehearsal/rehearsal-view.tsx` | 2 selects | Now, with its page |
| Session set-up | `live/setup-view.tsx`, `setup-sections.tsx`, `setup-controls.tsx` | target, host, matrix, policy, retention, consent | **Waits**: radio cards with a disabled reason (L9) |
| New brief, plan task, ask another question, scratchpad, answer text, command palette | `briefings/new-brief.tsx`, `home/plan-card.tsx`, `behavioural-pack.tsx`, `workspace/stage-panes.tsx`, `answers-tab.tsx`, `command-palette.tsx` | one box each | Leave |

## What was replaced

### 1. The interview context form

- `interview-context-form.ts` (new): the schema is `contractFormSchema(candidacyContextInputSchema)`;
  the uiSchema, `toContextFormData` and `toContextInput` are pure and tested.
- `interview-context-modal.tsx`: the four hand-placed fields, the per-field `useState` draft and
  the hand-written `canSave` are gone; `DynamicForm` draws the fields, `FormActions` holds Save and
  Clean up (both submit the form; Enter in a one-line field is Save), the error is a library
  `Alert`.
- Behaviour kept: create then PATCH, the company fixed once saved, Clean up saves first, the same
  messages. Changed: Save and Clean up sit under the fields, above the stages (they are the
  form's own actions); Close stays in the footer. The four `data-testid`s on the fields are gone
  (fields are found by role and label).
- Retired: `.pn-context-error` in `panels.css`. Still hand-built in this dialog, and not a form:
  the employer brief display (`.pn-context-brief*`) and the scrolling body (`.pn-context-fields`,
  which needs a scrolling `ModalBody` in the library, L10).

### 2. Settings › Behaviour

- `behaviour-flags-form.ts` (new): `behaviourFlagsSchema`, `behaviourFlagsValues`,
  `behaviourFlagsUiSchema`, `toFlagValues`, `changedFlag`, each a pure function of the registry. A
  test adds a flag to the list and sees it drawn, validated and valued with no other change.
- `behaviour-flags-setting.tsx`: the per-flag `Select` loop is gone. Each flag keeps its role
  (`button`) and its accessible name (its label), so the control inventory is unchanged.
- A change that does not save says "Not saved. Try again." under that flag (`ui:help`, since the
  form takes no server errors yet: L11) and the form is drawn again from what the Studio holds.

### 3. Employer said: add an entry

- `interview-brief/employer-said-form.ts` (new): schema from `employerSaidInputSchema`; the
  optional channel gains an empty "Not said" choice; `toEmployerSaidInput` drops empty fields and
  parses with the contract. Used by the Interview form and the Briefings setup alike.
- `brief-lists.tsx`: four `useState` fields, the `Textarea`, two `Input`s and the `Select` are
  gone; Add entry submits the form and the form is remounted empty.

## Requests to the library (precise)

| # | Part | What is missing | Why it matters here |
|---|---|---|---|
| L1 | `Form` / `DynamicForm` | After one submit that fails Zod, every later submit is dropped silently, even with valid values: the form-level `onSubmit` error is never cleared because values arrive through `setFieldValue` with no registered field, so `canSubmit` stays false. Reproduced in a test here. | No form can rely on submit-time validation. Blocks showing the library's inline errors. |
| L2 | `DynamicForm` | An `idPrefix` prop (RJSF's own), defaulting to the form's stable id. Today every form's fields are `root_<name>`. | Two forms on one screen; one form per list row (stages). |
| L3 | `Form` | `onSubmit` receives the raw values, not the Zod output its docs promise ("`onSubmit(parsed)`"). | Trims and defaults of the contract are lost unless the app parses again. |
| L4 | dynamic form templates | `ArrayFieldTemplate`, array item template and `AddButton` from library parts, with `labels` (today `@rjsf/shadcn`'s, "Add Item"). | People in a stage; any repeating row. |
| L5 | `dateTime` widget | An empty value (clear), `min`/`max`, and an ISO-instant storage option. | "When" of a stage and of the interview card. |
| L6b | `UiSchema` type | `ui:rows` is the library's own key but the exported type reads it as RJSF's number; export a typed `OmniUiSchema`. | Every uiSchema needs a widening cast. |
| L6 | `DynamicForm` | `fieldSize`, `fieldVariant`, `fieldLayout` from the root `ui:options` (audit C6); the object template's fixed 2rem / 1.5rem gaps as a density option. | Forms inside the native panels are dense. |
| L7 | `file` widget | Real file values (`mode: 'file'`), refusals as the field's error (audit E.2). | Transcript and research uploads, matrix import. |
| L8 | `tags` or `textarea` widget | A "one item per line" mode storing `string[]`. | The experience role editor. |
| L9 | `select`, `radio` widgets | A per-option disabled reason shown in the option (today `enumDisabled` only). | Languages not supported yet; session set-up choices. |
| L10 | `Modal` | A `ModalBody` that scrolls between header and footer. | Retires `.pn-context-fields`. |
| L11 | `DynamicForm` | A `serverErrors` (or `extraErrors`) prop: `FormError[]` by path, drawn as the field's error with `aria-invalid` and `role="alert"`. | "Not saved" for one flag; any refusal the server names a field for. |
| L12 | `SelectPrimitive` | Not searchable: once opened from the keyboard, focus is on the popover and the arrow keys and Enter do not move or choose (seen in jsdom; not yet checked in a browser). | Every select in the native window. |
| L13 | `FieldTemplate` | Description and error tied to the control (`aria-describedby`), error with `role="alert"` (audit C1, C5); section title drawn (C3). | The flags' help is not announced; "Behaviour" stays a `Divider` outside the form. |
| L0 | packaging | The vendored package resolves its own zod (4.6.5) while this repository pins 4.4.3: passing a contract as `zodSchema` fails to type-check and, for a `z.object` built from a list, runs `tsc` out of memory. zod should be a peer dependency. Until then `formParser` in `studio/shared/contract-form.ts` is the one cast. | Every form. |
| L14 | widgets | A `data-testid` (or any attribute) option per field; today it is always the element id. | Only for tests that cannot use a role and a label. |

## Not checked

- Nothing was looked at in a browser: how the form sits in the dialog and the Settings pane (the
  template's gaps, the two-column row) is unverified by eye. The browser suite and a visual pass
  are owed.
- The employer brief display inside the dialog was not moved to library parts (not a form).
- `backend/documents/api.ts` still parses the context PATCH with its own inline schema; it should
  read `candidacyContextInputSchema` so the bounds exist once (the documents worker's file).
