---
title: "UI components: vocabulary and rules"
slug: ui-components
type: references
tags: [ui, components, button, tokens, css, studio, overlay, native]
sources: []
last_reviewed: 2026-10-06
---

# UI components: vocabulary and rules

One component per job, configured by data, styled only by tokens. The home is
`products/interview/src/frontend/ui/`; `index.ts` is the only import path
(`import { Button } from "../ui"`). The decision and the audits behind it are in
`bionic/inbox/redesign/ui-components/plan.md`. No new package or dependency:
there is no Tailwind, `cva` or Radix here, and a 3-line `join` replaces `cn`.

## Files

| File | Job |
|---|---|
| `ui/button.tsx` | The `Button` component and its vocabulary (`BUTTON_VARIANTS`, `BUTTON_SIZES`) |
| `ui/ui.css` | Rules that select on `data-slot`, `data-variant`, `data-size`, `data-state`; read only `var(--ui-*)` |
| `ui/tokens.css` | The `--ui-*` token layer and the per-surface scopes (the only place a literal belongs) |
| `ui/join.ts` | Class joiner |
| `ui/button.test.tsx` | Behaviour matrix, plus a guard that reads the CSS |

Both stylesheets are imported at the top of `studio/tokens.css`, which the
product exports as `./studio.css`; the overlay, the native panels and Studio all
get them through that one path.

## Button API

`<Button>` renders a real `<button>` (or, with `asChild`, the single child
element, for `<a href>`). Props extend `ButtonHTMLAttributes`. `forwardRef`,
`displayName`, `type="button"` by default.

| Prop | Values | Default |
|---|---|---|
| `variant` | `primary` `secondary` `ghost` `destructive` `go` `link` `glass` | `secondary` |
| `size` | `sm` `md` `lg` `icon` | `md` |
| `icon` / `iconAfter` | an `IconName` (leading / trailing) | none |
| `loading` | sets `disabled`, `aria-busy`, `data-state="loading"`, a spinner replaces the leading icon | `false` |
| `pressed` | sets `aria-pressed`, `data-state="pressed"` | unset |
| `asChild` | clone the one child element instead of rendering a `<button>`; never reaches the DOM | `false` |

Emitted attributes: `data-slot="button"`, `data-variant`, `data-size`,
`data-state` (`idle` | `loading` | `pressed`).

### Variants

| Variant | Use it for |
|---|---|
| `primary` | The one main action of a surface or dialog (accent fill) |
| `secondary` | The default ordinary action (outlined) |
| `ghost` | Quiet actions and icon-only controls (transparent, fills on hover) |
| `destructive` | End, Delete (red fill) |
| `go` | Start or Resume (green fill) |
| `link` | An inline text action (underline on hover, no frame, no fixed height) |
| `glass` | Controls on translucent chrome: native panels, toolbars, pills |

### Sizes

| Size | Height token | Height | Use |
|---|---|---|---|
| `sm` | `--ui-height-sm` | 28px | Dense rows, toolbars |
| `md` | `--ui-height-md` | 32px | Default |
| `lg` | `--ui-height-lg` | 40px | Top-level live buttons |
| `icon` | `--ui-height-icon` | square, same as `md` | Icon only; give it an `aria-label` |

The 40px rule: every top-level button on the live page needs a 40px hit area
(`studio/live/layout-rules.test.ts`, `session-bar.test.tsx`), so those use
`size="lg"`.

### States

- **Hover** applies only to `:hover:not(:disabled):not([aria-disabled="true"])`.
- **Focus** is one ring on `:focus-visible` (`--ui-focus-ring`, `--ui-focus-width`, `--ui-focus-offset`) for every variant.
- **Disabled** uses the native `disabled` attribute (an `asChild` anchor uses `aria-disabled="true"` and `tabindex="-1"`): cursor `default`, opacity `--ui-disabled-opacity`.
- **Loading** is disabled plus `aria-busy`: cursor `progress`, opacity `--ui-loading-opacity`.
- **Pressed** looks like hover, held (the variant's `-hover` background).

## Tokens

Components read only `--ui-*`. `ui.css` and the component write no colour
literal, length, opacity or duration (the test enforces it).

- **Structure (`:root`)**: `--ui-height-{sm,md,lg,icon}`, `--ui-pad-{sm,md,lg}`, `--ui-gap`, `--ui-font-size-{sm,md,lg}`, `--ui-font-weight`, `--ui-line-height`, `--ui-icon-size`, `--ui-icon-size-lg`, `--ui-radius`, `--ui-radius-glass`, `--ui-border-width`, `--ui-underline-offset`, `--ui-focus-width`, `--ui-focus-offset`, `--ui-disabled-opacity`, `--ui-loading-opacity`, `--ui-transition`, `--ui-spinner-{size,width,speed}`, `--ui-text-shadow`.
- **Colour roles per intent**: `--ui-<intent>-bg | -fg | -border | -hover` for `primary`, `secondary`, `ghost`, `destructive`, `go`, `glass`; `--ui-ghost-fg-hover`; `--ui-link-fg`, `--ui-link-fg-hover`; `--ui-glass-edge`, `--ui-glass-blur`; `--ui-focus-ring`.
- **Surface scopes** map the roles onto what each surface already defines. `:root` holds a neutral fallback.

| Scope | Selector | Maps onto |
|---|---|---|
| Studio | `.studio-app .oa-host` (and its `[data-theme]` wrappers, the palette scrim) | `--accent`, `--surface`, `--border`, `--subtle`, `--hover`, `--text`, `--muted`, `--red`, `--green` |
| Overlay | `.ov-root`, `.ov-card`, `.ov-sheet` | `--ov-btn`, `--ov-btn-hover`, `--ov-accent`, `--ov-red`, `--ov-green`, `--ov-chip`; 6px radius, opacity .45 |
| Native panels | `.pn-root` (and `.pn-root .ov-card`) | `--pn-accent`, `--pn-link`, `--pn-glass-fill`, `--pn-control-line`, `--pn-blur-control`; the Resume green fill with a white .45 border; glass is a pill |
| Clear glass | `.pn-root[data-glass="clear"]` | the stronger hairline and chip tokens panels.css redeclares |

## Rules

1. Never hard-code a colour, radius, height, spacing or opacity in a component or in a rule you migrate; use or add a `--ui-*` token.
2. A button is a real `<button>` or `<a href>`, never a `div`: the native shell's drag and cursor probe (`apps/studio-shell/Sources/StudioShellCore/WindowDrag.swift`) treats `button`, `a[href]`, `[role=button]`, `[disabled]` and `[aria-disabled]` as controls.
3. Disabled and loading use `disabled` (anchors: `aria-disabled`).
4. CSS selects on the data attributes only; never on a variant class.
5. Import from `../ui`, never from a file inside it.
6. Keep labels and accessible names when migrating; tests use `getByRole("button", { name })`.
7. Legacy container classes (`.pn-pill`, `.pn-single-foot`, `.pn-strip`) stay.

## Adding a variant

1. Add the name to `ButtonVariant` and an entry to `BUTTON_VARIANTS` in `button.tsx` (the type is a `Record`, so it will not compile without one).
2. Add its `--ui-<name>-*` roles to the `:root` fallback and to every surface scope in `ui/tokens.css`.
3. Add a `[data-slot="button"][data-variant="<name>"]` rule to `ui/ui.css` that sets the `--ui-btn-*` locals from those roles.
4. Update the vocabulary tables here. `button.test.tsx` fails until the CSS rule, the tokens and the scope mappings exist; adding a size follows the same path through `BUTTON_SIZES` and `--ui-height-<name>`.

## Promotion

Everything imports from one `index.ts`, so moving to a `packages/ui` package
later is mechanical (an ADR, an export-surface row, a wider react vitest
include). Do it when a second product, Presentation, adopts the components.
