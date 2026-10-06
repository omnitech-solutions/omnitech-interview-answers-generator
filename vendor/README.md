# vendor/

Packed (`.tgz`) copies of three sibling repositories that are not published to
a registry this repository installs from. The root `package.json`
`pnpm.overrides` points every one of these package names at its tarball
(`file:vendor/...`), so any workspace package that depends on one resolves to
the committed file, and `pnpm install --frozen-lockfile` needs no sibling
checkout.

Facts below come from `package.json` (`pnpm.overrides`), the header of
`scripts/assistant-sync.mjs`, each tarball's own `package/package.json` (read
with `tar -xOzf <file> package/package.json`), and the sibling checkouts next to
this repository. Anything not derivable from those is marked unknown.

## Tarballs

Sibling checkouts live beside this repository (`../<name>`). Git remotes are
those of the local sibling checkouts at the time of writing.

| Tarball | Package | Version | Sibling repository | Sibling path |
|---|---|---|---|---|
| `omnitech-assistant/omnitech-assistant-contracts-0.1.0.tgz` | `@omnitech-assistant/contracts` | 0.1.0 | `omnitech-assistant` | `packages/contracts` |
| `omnitech-assistant/omnitech-assistant-providers-0.1.0.tgz` | `@omnitech-assistant/providers` | 0.1.0 | `omnitech-assistant` | `packages/providers` |
| `omnitech-assistant/omnitech-assistant-server-0.1.0.tgz` | `@omnitech-assistant/server` | 0.1.0 | `omnitech-assistant` | `packages/server` |
| `omnitech-assistant/omnitech-assistant-storage-postgres-0.1.0.tgz` | `@omnitech-assistant/storage-postgres` | 0.1.0 | `omnitech-assistant` | `packages/storage-postgres` |
| `omnitech-assistant/omnitech-assistant-sdk-0.1.0.tgz` | `@omnitech-assistant/sdk` | 0.1.0 | `omnitech-assistant` | `packages/sdk` |
| `omnitech-assistant/omnitech-assistant-react-0.1.0.tgz` | `@omnitech-assistant/react` | 0.1.0 | `omnitech-assistant` | `packages/react` |
| `omnitech-assistant/omnitech-assistant-provider-on-device-0.1.0.tgz` | `@omnitech-assistant/provider-on-device` | 0.1.0 | `omnitech-assistant` | `packages/provider-on-device` |
| `omnitech-on-device-llm/omnitech-local-assistant-0.1.0.tgz` | `@omnitech/local-assistant` | 0.1.0 | `omnitech-on-device-llm` | `packages/assistant` (its directory name differs from the package name) |
| `omnitech-on-device-llm/omnitech-local-inference-0.1.0.tgz` | `@omnitech/local-inference` | 0.1.0 | `omnitech-on-device-llm` | `packages/runtime` (its directory name differs from the package name) |
| `omni-ui-components/oc-tech-omni-ui-components-0.0.2.tgz` | `@oc-tech/omni-ui-components` | 0.0.2 | `omni-ui-components` | `packages/core` |

- `omnitech-assistant` local remote: `git@github.com:desoleary/omnitech-assistant.git`.
- `omnitech-on-device-llm` local remote: `git@github.com:omnitech-solutions/omnitech-on-device-llm.git`.
- `omni-ui-components`: the tarball's own `repository` field is
  `git+https://github.com/omnitech-solutions/omni-ui-components.git`, directory
  `packages/core`; licence `UNLICENSED`. The other tarballs carry no
  `repository` or `license` field.
- Which sibling commit each tarball was packed from: **unknown**. Nothing in the
  tarballs or this repository records it. Git history only shows when each file
  was committed (`git log -- vendor`).

What each tarball contains: a `dist/` build (the assistant server's declares
`files: ["dist"]`; `storage-postgres` also ships `migrations/`), plus
declaration and source maps. The `@omnitech/local-inference` and
`@oc-tech/omni-ui-components` tarballs also list a `README.md` in `files`.

## Why `pnpm.overrides` points here

The assistant packages are unpublished siblings and depend on one another with
exact `0.1.0` versions. `provider-on-device` was packed with its two
`@omnitech/local-*` dependencies as relative `file:../../vendor/omnitech-on-device-llm/...`
specifiers. The override list forces every occurrence, including those inside
other tarballs, to the committed file, so one copy of each resolves. Why a
registry or `workspace:` link was not chosen is **unknown** (no ADR found in
`bionic/adrs` mentions it).

The audit finding PN-DEP-02 notes that pnpm's `blockExoticSubdeps` forbids
tarball sources for transitive dependencies; the overrides are the way these
`file:` specifiers are applied, and the `pnpm install --frozen-lockfile`
result is the check that they still resolve.

## Build and refresh

The header of `scripts/assistant-sync.mjs` says vendoring is "`pnpm pack` in
omnitech-assistant -> vendor/"; `README.md` says `npm pack`. Which one was
actually used for the existing files is **unknown**. Both produce the same
`package/` layout from the `files` list.

1. In the sibling checkout, build the package: each tarball's `package.json`
   has `scripts.build` (`tsc -p tsconfig.json`; `@omnitech/local-inference`
   also bundles `dist/worker.bundle.js` with esbuild; `@oc-tech/omni-ui-components`
   uses `vite build`; `@omnitech-assistant/react` also copies `src/styles.css`
   to `dist/`).
2. Pack it from the package directory, for example
   `cd ../omnitech-assistant/packages/server && pnpm pack` (or `npm pack`),
   which writes `<scope>-<name>-<version>.tgz`.
3. Replace the matching file under `vendor/<repository>/`, keeping the file
   name the `pnpm.overrides` entry names. A version bump needs the override
   path in the root `package.json` changed to match.
4. Run `pnpm install` (this refreshes `pnpm-lock.yaml`), then `pnpm verify`.
   Commit the tarball and the lockfile together.

Inner-loop shortcut: `node scripts/assistant-sync.mjs [--no-build]` builds
`../omnitech-assistant` (or `$OMNITECH_ASSISTANT_SRC`) and `rsync`s its `dist`
(and `migrations` for `storage-postgres`) into the installed
`@omnitech-assistant/*` copies under `node_modules/.pnpm`, without touching
`package.json`, the lockfile or `vendor/`. It covers six packages only
(`contracts`, `providers`, `server`, `storage-postgres`, `sdk`, `react`); it is
for development, and the committed tarballs must still be re-packed to ship a
change. It does not cover `provider-on-device`, `@omnitech/local-*` or
`omni-ui-components`.

No script in this repository repacks the tarballs; the steps above are manual.
