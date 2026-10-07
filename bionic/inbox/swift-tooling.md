# Swift tooling: swift-format, SwiftLint, coverage

2026-10-06. Covers the 109 Swift files in `apps/studio-shell` and `apps/capture-companion/macos`.

## Tools and pins

| Tool | Version | Role | Config |
| --- | --- | --- | --- |
| Apple swift-format | 6.2.3 (Command Line Tools, `xcrun swift-format`) | layout: 4 spaces, 120 columns | `.swift-format` |
| SwiftLint | 0.65.1 (`brew install swiftlint`) | correctness and complexity | `.swiftlint.yml`, `.swiftlint.baseline.json` |

SwiftLint's layout rules that overlap swift-format are disabled in `.swiftlint.yml`, each with its reason.
The baseline holds the findings that predate the tooling (function length, complexity, large tuples, `unowned` captures,
lossy `String(decoding:)`); only new findings fail. Regenerate it with `node scripts/swiftlint.mjs --write-baseline`.
With only the Command Line Tools, SwiftLint needs `TOOLCHAIN_DIR`; `scripts/swiftlint.mjs` sets it.

## Commands

- `pnpm format:swift` checks layout (`--strict`); `pnpm format:swift:write` rewrites it.
- `pnpm lint:swift` runs SwiftLint (`--strict`, with the baseline).
- Both run inside `node scripts/verify-native.mjs` (so `pnpm verify`) before the Swift builds, and in the `lefthook.yml`
  pre-commit hook on staged `*.swift` files. Off macOS they skip; on macOS a missing tool fails with an install hint.
- `node scripts/swift-coverage.mjs` builds each test harness with LLVM profiling in `.build-cov` and fails below 80% line
  coverage for CaptureCore and for StudioShellCore plus Engine. The AppKit target `Sources/studio-shell` (outside
  `Engine/`) has no harness and is not measured.

## CI

The `native` job runs the gates through `verify-native.mjs` and then `swift-coverage.mjs`. Unverified on GitHub: the
runner's SwiftLint version may differ from 0.65.1 and change what the baseline matches.
