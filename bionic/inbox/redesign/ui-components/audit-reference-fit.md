# Audit D: reference library conventions and fit to this repo

Read-only analysis, 2026-10-06. Paths: REF = `/Users/desoleary/dev/omnitech-solutions/omni-ui-components/packages/core`; REPO = this repository.

## Part 1. The reference library (omni-ui-components)

### Organisation
- pnpm/turbo monorepo with one package, `@oc-tech/omni-ui-components` (REF/package.json:2). `"type":"module"`, `sideEffects: ["**/*.css"]` (:20), exports `.`, `./styles.css`, `./dynamic-form` only (:24-37). react / react-dom are peers (:42-45); runtime deps include `class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/*`, `lucide-react` (:75-98).
- Built with `vite build` (library mode, es + cjs, one CSS file named `styles`, every dependency external) with `@tailwindcss/vite` and `vite-plugin-dts` (REF/vite.config.ts:14-47). Types go to `dist-types/`.
- Two layers coexist:
  1. `src/components/ui/*.tsx`: raw shadcn primitives, one file per primitive (alert, badge, button, card, dialog, dropdown-menu, input, popover, select, sheet, switch, tabs, toggle, toggle-group, tooltip, ...), Tailwind classes inline, import `cn` from `lib/utils` (a tsconfig path alias).
  2. `src/<Name>/` namespaced "Omni" wrappers (`Button/`, `Badge/`, `Tabs/`...). Each folder has `X.tsx`, `X.variants.ts` (the cva), `X.types.ts`, `X.stories.tsx`, `X.factories.tsx`, `index.ts`. `src/index.ts` re-exports every folder with `export *` (index.ts:1-60).
- `cn` = `twMerge(clsx(inputs))` (REF/src/lib/utils.ts:4-6).
- Tokens: `src/styles/{base-palette,theme-tokens,tailwind,tokens}.css`; component tokens `--oui-*` (`--oui-surface-field`, `--oui-border-field`, `--oui-radius-field`, `--oui-field-height-sm|md|lg|xl`, `--oui-font-sans`...) declared in `@layer omni-ui-components` with a reduced-motion override (REF/src/styles/tokens.css:3-33).
- Docs/tests: Storybook (`.storybook/`, `Button.stories.tsx` with `tags: ['autodocs']`, argTypes, an explicit SizesMatrix story), a `*.factories.tsx` giving default props plus an ordered `Variant[]` matrix (Button.factories.tsx), and Vitest + Testing Library tests in a parallel `test/<Name>/` tree (e.g. `test/Button/Button.test.tsx`: role, `data-slot`, default `type=button`, icons, variants).

### Component conventions to mirror
| Concern | Reference (file:line) |
|---|---|
| Variants | cva with `variant` x `size` and `defaultVariants` (ui/button.tsx:7-31) |
| Button variant vocabulary | `default`, `destructive`, `outline`, `secondary`, `ghost`, `link` (ui/button.tsx:11-18) |
| Button size vocabulary | `default`, `sm`, `lg`, `icon` (ui/button.tsx:19-24); wrapper renames the prop `buttonSize` (sm, default, md, lg, icon) to avoid the DOM `size` attribute (Button.types.ts:11) |
| Badge | `default`, `secondary`, `destructive`, `outline`; no size (ui/badge.tsx:10-15) |
| Toggle | `default`, `outline` x `default`, `sm`, `lg`; on-state via `data-[state=on]` (ui/toggle.tsx:8-19) |
| Alert | `info`, `warning`, `error`, `success`, `loading` x `default`, `sm`; role/aria-live derived from variant (ui/alert.tsx:7-25, 57-58) |
| Polymorphism | `asChild` + Radix `Slot` in the shadcn button (ui/button.tsx:33-39) |
| Refs / names | `React.forwardRef` plus `Component.displayName = '...'` on every primitive; Radix wrappers reuse `Primitive.displayName` (ui/toggle.tsx:32) |
| Exports | component and its `xVariants` exported together (`export { Button, buttonVariants }`) so non-button elements can wear button styling |
| Data attributes | wrapper emits `data-slot="button"`, `data-variant`, `data-button-size` (Button.tsx:23-25); Radix state attrs styled with `data-[state=...]` (tabs.tsx:32, popover.tsx:20) |
| Icons | `icon` (leading) and `iconAfter` (trailing) props; `[&_svg]:size-4 pointer-events-none shrink-0` in the base class (Button.variants.ts:10-17) |
| Focus / disabled | `focus-visible:ring-2`, `disabled:pointer-events-none disabled:opacity-50` in the base string |
| A11y | `type` defaults to `button` (Button.tsx:18); Alert sets `role`, `aria-live`, `aria-atomic`, icon `aria-hidden` (alert.tsx:57-69); Radix supplies keyboard/ARIA for tabs, popover, dropdown, select, dialog, tooltip, switch |
| Tests | behaviour-level (roles, attributes, user-event), one file per component; no snapshot reliance observed |

### Defects and gaps in the reference (do not copy)
- The wrapper `Button` declares `asChild` in its props (Button.types.ts:22-23, comment says "Renders as `<a>`") but never destructures it (Button.tsx:18-27), so it falls into `...rest` and lands on the DOM `<button>`. Only `ui/button.tsx` implements `asChild`.
- No `loading` state, no `state`/`pressed` prop; the wrapper is wrapped in `React.memo` (Button.tsx:38), which is unneeded for a leaf.
- Everything is Tailwind class strings plus `tailwind-merge`; colour is `bg-primary`-style utilities. Nothing of the class vocabulary transfers to plain CSS; only the API shape does.

## Part 2. Fit to this repository

### Facts
| Question | Finding |
|---|---|
| Tailwind / cva / clsx / radix in this repo's own code? | None. `grep` of every package.json outside node_modules finds only `@oc-tech/omni-ui-components` (root package.json:58 override; apps/web/package.json:17). No `cn` utility. |
| Is the reference library already here? | Yes, as a vendored tarball `vendor/omni-ui-components/oc-tech-omni-ui-components-0.0.2.tgz` (vendor/README.md table; root `pnpm.overrides`). apps/web depends on it, but the only use is the stylesheet: `apps/web/app/layout.tsx:5` `import "@oc-tech/omni-ui-components/styles.css"`. No source file imports a component from it (grep over apps, products, packages). Its 182 KB `dist/styles.css` is precompiled Tailwind in `@layer theme/base/components/utilities/omni-ui-components`. |
| Why that matters | A vendored, precompiled Tailwind build cannot restyle product classes: only utilities the library itself used exist in the CSS. Products would need `@oc-tech/omni-ui-components` declared (guard: dependency-declarations) and would get `--oui-*` look, not `--ov-*`/`--pn-*`. The tarball's package exports contain no `./Button` subpath (REF/package.json:24-37); the stories use a tsconfig alias. Refreshing it is manual (vendor/README.md "Build and refresh"). |
| Dependency policy | No written dependency policy or allow-list found (grep of AGENTS.md, bionic/AGENTS.md, ADRs, doctrine). The mechanical rules are: declared = imported (scripts/dependency-declarations.test.ts:1-12), `catalog:` versions for shared ones (pnpm-workspace.yaml), ADR-0002 scope checkpoint before adding infrastructure (AGENTS.md rule 1). cva, clsx and `@radix-ui/react-slot` would all be NEW to the lockfile except as transitive deps of the vendored tarball (the tarball lists them as dependencies, so they may already sit in `node_modules/.pnpm`, but nothing declares them). |
| Styling system | Plain CSS with tokens. Studio tokens hang off `.studio-app`; the overlay is deliberately independent: "carries its own" tokens (overlay.css:1-5): `--ov-*` (overlay.css:9-27, including `--ov-btn`, `--ov-btn-hover`, `--ov-accent`, `--ov-red`) and `--pn-*` for panels (panels.css:18-44, including `--pn-control: 30px`). Button classes today: `.studio-button` (studio-base.css:252-271), `.ov-button` (overlay.css:830-851, `.primary` at :1401), `.pn-bar-button` (panels.css:190-204), `.pn-mini-button`. |
| How CSS is bundled | No CSS imports in TS. `products/interview/package.json` exports `"./studio.css": "./src/frontend/studio/tokens.css"` (a raw source file, not in dist); `tokens.css:1-11` `@import`s every feature stylesheet; `live.css:5-14` imports `overlay/overlay.css` and `panels/panels.css`. `apps/web/app/layout.tsx:8` imports `@omnitech/product-interview/studio.css`. ADR-0004:38-41 says the shell composes a product by "importing its exported stylesheet". The native shell and PiP window load the same overlay route from apps/web, so they get the same CSS; there is no second bundle. |
| Existing shared UI precedent | Product-internal: `products/interview/src/frontend/studio/shared/` (dialog.tsx, use-copied.ts). No package under `packages/` contains React; the vitest `react` project only includes `products/*/src/frontend/**` (vitest.config.ts react project `include`), the node project includes `packages/*/src/**/*.test.ts`. |
| Storybook / gallery | None found (no storybook dependency, no `/dev` or gallery route). apps/web files are capped at 150 lines by scripts/web-thinness.test.ts (MAX_FILE_LINES), so a gallery page there is not free. |
| ADR text on shared UI | ADR-0004:50-52: "Product frontend code may depend on platform contracts and shared UI, never on `apps/web`." So shared UI is already contemplated, location unspecified. ADR-0003:61 "A new package is added for a demonstrated second implementation or an independent lifecycle." ADR-0002:35 same test for any abstraction or boundary. |

### Guards a new package must pass (scripts/)
| Guard | What a `packages/ui` would need |
|---|---|
| package-boundaries.test.ts:207 (exports map only) | `exports` entry; consumers import only the declared subpaths |
| package-boundaries.test.ts:120 (`packages/*` never import `products/*`) | ui imports no product (it must own its tokens, not read `--ov-*` from a product); fine |
| package-boundaries.test.ts:202 (no orphan libraries) | at least one importer must exist in the same change |
| package-boundaries "declared = imported" | importers list `@omnitech/ui` as `workspace:*` |
| export-surface.test.ts | a new row `{entrypoints, names}` in `surfaces`, plus a reason for every entrypoint beyond `.` (a `./ui.css` style export is an extra entrypoint needing a written reason, as `./studio.css` is treated for the product) |
| test-exclusion.test.ts | `tsc -b` build tsconfig must exclude `*.test.tsx` (pattern: products/interview tsconfig.json:1-15) |
| dependency-declarations.test.ts | every external import (react, cva, clsx, Slot) declared in the package.json |
| vitest.config.ts | the `react` project include must be widened to `packages/ui/src/**/*.test.{ts,tsx}` (today the node project would not pick up `.tsx`) |
| lefthook / `pnpm verify` | lint (biome), format, typecheck, coverage thresholds 90/80 apply to the new code |
| ADR | required by AGENTS.md rule 2 and the propose-adr constraint in plan.md |

A product-internal folder triggers none of these except the normal frontend gates (react vitest project, biome, coverage).

## Recommendation: ONE option

**Build the primitives product-internal first, in `products/interview/src/frontend/ui/`, as plain CSS driven by data attributes, mirroring the reference API; no new package, no Tailwind, promote to `packages/ui` only when a second product consumes it.**

Rationale
1. The second implementation is real but inside one product: every button listed in the plan (web banner, session bar, native strip and footer) lives in `products/interview`, and the native panels are web content from the same route, so one frontend folder reaches all of them. ADR-0002:35 and ADR-0003:61 ask for a demonstrated second implementation of the *abstraction across boundaries*; here no boundary is crossed, so no package and no ADR are mandated. (Presentation has a frontend dir but its use is unverified.)
2. The styling coupling is to product tokens (`--ov-*`, `--pn-*`, overlay.css:1-5 says the overlay is intentionally independent of Studio tokens). A `packages/ui` could not reference them without importing from a product (forbidden direction) or inventing a third token set that must then be mapped back.
3. Zero guard churn: no export-surface row, no vitest include change, no ADR, no tarball refresh.
4. It ships through the existing path: add `ui/ui.css` and one `@import` line in `tokens.css`; the overlay, Studio and native-hosted panels all get it via the existing `./studio.css` export. No new bundle, no apps/web edit.
5. Vendored omni-ui-components stays untouched (it is Tailwind-compiled, `--oui-*`, and cannot be restyled here).

Minimal layout (one file per primitive, as in the reference, but no `.variants.ts` split)
```
products/interview/src/frontend/ui/
  index.ts          # the only import path inside the product: "../ui"
  button.tsx        # Button + buttonClass(); forwardRef, displayName, data-slot/data-variant/data-size/data-state
  button.test.tsx   # role, default type=button, variant/size attrs, loading disables + aria-busy, asChild, icons
  badge.tsx, toggle.tsx, ...   # added slice by slice as audits B/C justify
  ui.css            # [data-slot="button"][data-variant="primary"] { ... } mapped to --ov-*/--pn-* with a scope switch
  join.ts           # 3-line class joiner (replaces cn; no twMerge needed with plain CSS)
```
API (copy the vocabulary): `variant` (`default | go | secondary | outline | ghost | destructive | link`; exact set from Audits A/B), `size` (`sm | default | lg | icon`), `icon`, `iconAfter` (as `iconPosition` if preferred), `loading`, `asChild`, `type="button"` default, `forwardRef`, `displayName`, `defaultVariants` expressed as default parameter values. Variant/size are typed string unions with a `Record<Variant,...>` map where a class is needed.
- cva: not required. Plain CSS selects on `data-variant`/`data-size`, so cva's job (variant to class string) disappears; this adds no dependency. If the owner insists on `buttonVariants()` for non-button elements, cva + clsx are two small declared dependencies (no policy forbids them, ADR-0002 scope note only).
- Slot: add `@radix-ui/react-slot` only if Audit A finds anchor-styled buttons that must stay `<a>`; otherwise a 10-line `cloneElement` `asChild` is enough. Do not copy the reference's unimplemented `asChild`.
- Tokens: Studio buttons read `--accent/--line/--paper`; overlay reads `--ov-*`; panels `--pn-*`. `ui.css` defines `--ui-button-bg|fg|hover|height` per surface scope (`.studio-app`, `.ov-root`, `.pn-*` roots) so the component has one class vocabulary and the surface supplies colour.
- Native shell: class names drive hit regions (plan.md constraint). Keep `.pn-pill`/`.pn-single-foot` etc. on containers untouched; the Button emits a stable `data-slot="button"` that `HIT_SELECTORS` can add (update hit-regions, `WindowDragTests`, glass-guard together).
- Documentation of variants (no Storybook): (a) a variant x size x state matrix test that renders every combination and asserts attributes (the reference's `Variant[]` factory idea), (b) a short reference page under `bionic/research/references/` listing the vocabulary, (c) optionally a screenshot matrix in the existing browser e2e (`e2e/live-session`). A gallery route in apps/web is rejected (150-line cap, thin shell).
- Promotion path: because everything imports from one `index.ts`, moving to `packages/ui` later is mechanical: ADR, new package, export-surface row, widen the react vitest include.

### Alternatives rejected
| Alternative | Why rejected |
|---|---|
| New `packages/ui` now | Needs ADR, export-surface row, vitest include, a token contract the product-forbidden direction cannot satisfy, and an orphan-library justification; second implementation is not across a boundary yet (ADR-0002:35, ADR-0003:61). Strongest runner-up; becomes right when Presentation adopts it. |
| Consume the vendored `@oc-tech/omni-ui-components` Button | Tailwind precompiled (182 KB) with `--oui-*` look; cannot express overlay glass tokens; no `loading`; its wrapper ignores `asChild`; no `./Button` subpath; manual tarball refresh; adds a declared dependency to the product. |
| Add Tailwind + cva + tailwind-merge + Radix to mirror the reference literally | New build tooling in a plain-CSS repo (ADR-0002 scope checkpoint), would fight 26 existing CSS files and the native hit-region class lists; two styling systems. |
| Per-surface components (separate Studio button, overlay button, panel button) | The status quo that produced three Resume buttons. |
| CSS Modules per component | Not used anywhere in the repo; the build is tsc plus a source-CSS export, so modules need new bundler assumptions. |
| Put it in `apps/web` | Violates ADR-0004:38 (shell holds no product styling) and "product frontend never imports apps/web". |

### Open questions for the orchestrator
- Does Presentation's frontend (`products/presentation/src/frontend`) need buttons now? If yes, that tips the choice to `packages/ui` with a propose-adr.
- Confirm cross-package CSS `@import` is not needed (the recommendation avoids it by staying inside the product).
