# L5 audit: native Swift and the cross-language seam

Read-only audit, live tree of branch feat/active-session. Paths are relative to the repo root.

## 1. Scope and method

Inspected (read in full or in the relevant parts):
- `apps/studio-shell`: StudioShellCore (HostBridge, BridgeTrust, NativeSignIn, Pairing, Hotkeys, StudioLocation, BrowserFocus, ScreenWatch decoder), the studio-shell executable (BridgeHandler, StudioWebView, SignInCoordinator, ShellModel, ShellCapture, HotkeyCenter, AppDelegate), Engine (EngineBridge, WebViewOwnerRoutes, OwnerRoutes, SystemCompanionRun, EngineModel), `scripts/bundle-app.sh`, `Package.swift`.
- `apps/capture-companion/macos`: Limits, Endpoint, Wire (enums), KeychainCredentialStore, ImageEncoding, Commands.swift, `scripts/bundle-app.sh`, `Package.swift`.
- TS side of the seam:
  - `packages/interview-contracts/src/studio-host.ts`
  - `products/interview/.../live/host-adapter.ts` and its consumers
  - `packages/active-session-contracts` (limits, control, observation, ids, credential, schema generator)
  - `apps/web/app/api/native-auth/*` and `src/platform/native-handoff.ts`
  - the TS mirror core in `apps/capture-companion/src`

Commands run (scratch build dirs only, nothing written to the repo):
- `swift build` for both packages: **0 warnings** (the HEAD baseline's 1 warning is gone).
- `swift build -Xswiftc -strict-concurrency=complete` on studio-shell: **59 unique diagnostics and 1 error**. By file: ConnectPrompt 24, StudioWebView 19, ShellModel 8, NativeSurface 2, HotkeyCenter 2, one each in ShellCapture, ScreenSampler, BridgeHandler (the error: it does not conform to `WKScriptMessageHandlerWithReply`) and AppDelegate.
- `swift run capture-core-tests`: 63 passed. `swift run studio-shell-tests`: 82 passed.
- Periphery: only the HEAD-snapshot JSON exists (no later run). I re-checked each item against the live tree.
- invariants: none of the 9 pins or checks cover Swift or the bridge, so there was nothing to run in this layer.

Not inspected: NativeSurface/PanelLayout/StatusMenu/ConnectPrompt UI internals, OnDeviceSpeech, AudioRingBuffer, Outbox, CompanionSession logic. Apple's WKWebView docs are JavaScript-rendered, and WebFetch returned only the page title. Bridge points below rest on the code and are not backed by cited docs (inferred).

## 2. Findings

| ID | Sev | Evidence | Rule | Fix | Lines | Risk | ADR |
|---|---|---|---|---|---|---|---|
| L5-01 | HIGH (active bug) | Swift `HostCapability` has no `screen-watch` (`HostBridge.swift:16-23`), and `BridgeScriptTests.swift:35` pins the list. TS `screenWatchHost()` requires `capabilities.has("screen-watch")` (`host-adapter.ts:32`) and nothing else reads `studioHost.screenWatch`. The native screen watch is therefore never used by Auto, even though `screenWatch` is defined on the host object (`HostBridge.swift:338`). | Inconsistency, ADR-0019 | Add `case screenWatch = "screen-watch"` to Swift (and to the test); add a parity test (G1). | 6 | low | n |
| L5-02 | MED | The Swift list has `engine`, which TS does not know, so `negotiateStudioHost` drops it (`studio-host.ts:179-195`). `use-engine.ts:21` reads `window.studioHost.engine` directly, outside negotiation. | Inconsistency | Add `engine` to `STUDIO_HOST_CAPABILITIES`, or stop advertising it. | 8 | low | n |
| L5-03 | MED | `displayId` type diverges. TS `StudioHostCaptureRequest.displayId` and the result are `string` (`studio-host.ts:35-42,70`, `host-adapter.ts:102,138`). Swift decodes a number and replies `Int(displayId)` (`HostBridge.swift:163-169,230`). A string would be refused as invalid. It works only because JS does no type check. The TS `isStudioHostDisplayId` is therefore unused or wrong. ScreenWatch uses `number`. | Contract mismatch | Make the TS contract `number` (u32) everywhere, or have Swift send a string. | 20 | med | n |
| L5-04 | HIGH (process) | `pnpm verify` runs no Swift (`package.json:22`; no CI dir). The Swift-side drift tests (limits parity, corpus conformance, BridgeScript) never run in the gate. Both Swift suites are green today. | AGENTS "verify before completion" | Add a read-only `swift build` plus `swift run *-tests` script, run on macOS (a `verify:native` script or step). | 15 | low | y (adds a gate) |
| L5-05 | MED | `ShellModel.studioFetch` runs `callAsyncJavaScript` in `.page` (`ShellModel.swift:137-152`). A page that replaces `fetch` can spoof the session list, `current` and the pause target. `WebViewOwnerRoutes` uses the private world `studio-shell-engine` for exactly this reason (`WebViewOwnerRoutes.swift:5-9`). The two are also duplicate fetch helpers. | Inconsistency, duplication | Move `studioFetch` into the private world and merge it with `WebViewOwnerRoutes.request`. | 30 | low | n |
| L5-06 | MED | Bridge exposure. The handler is registered in `.page` world and trusts the exact Studio origin plus the main frame (`StudioWebView.swift:110`, `BridgeTrust.swift:29`). Trust is sound, but any script on Studio's origin (XSS or third-party) can capture the screen, quit the app or open URLs. `openExternal` takes any http(s) host with no user-gesture requirement (`HostBridge.swift:197`, `BridgeHandler.swift:94`). | Hardening (inferred) | Keep it. Add a strict CSP test for the overlay route, and optionally a host allowlist or rate limit on `openExternal`. | 20 | low | n |
| L5-07 | MED | `StudioShellCore` imports `CaptureAdapters` (Keychain, ScreenKit, files) via `Pairing.swift:1`. The Core is meant to be pure decisions. | ADR-0003 spirit | Move `StudioPairing` into StudioShellEngine, or inject `CredentialStore` and `CompanionPaths` by protocol from CaptureCore. | 20 | low | n |
| L5-08 | MED | Tenant slug regex differs. Swift `Endpoint.isValidSlug` is `^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$` (`Endpoint.swift:92`). The web side is `^[a-z0-9][a-z0-9-]{0,62}$` (`native-handoff.ts:127`). Swift admits uppercase, dots and underscores that the server would reject. | Inconsistency | Align Swift to the canonical slug rule, with a parity test reading the TS regex. | 6 | low | n |
| L5-09 | MED | Screenshot cap and frame budget. Swift encodes up to `maxScreenshotBytes` (2 MiB), but the page re-encodes anything over `HOST_FRAME_MAX_BYTES = 1_800_000` (`host-adapter.ts:82`). Frames of 1.8 to 2 MiB are needlessly recompressed in the page. `maxOwnerCaptureBytes` (interview-contracts, `live-session.ts:334`) and `ACTIVE_SESSION_LIMITS.maxScreenshotBytes` are two separate 2 MiB constants. | Duplication | Give the shell an encode budget derived from `maxOwnerCaptureBytes` minus base64 and form overhead (Swift constant plus a parity test), and drop the page re-encode or derive it. | 15 | low | n |
| L5-10 | MED | The JPEG ladder and `encode()` are duplicated: `ShellCapture.swift:130-157` vs `ImageEncoding.swift:34-69` (internal, so the shell cannot reuse it). Focus tracking is duplicated: `ShellCapture.swift:31-61` vs `FocusTracker` (`SystemCompanionRun.swift:59-86`) vs `ScreenKitOneShot.sampleFocus`. | Duplication | Make `ImageEncoder` public and have ShellCapture use it. Have ShellCapture use `FocusTracker`. | -80 | low | n |
| L5-11 | MED | `SystemCompanionRun` is self-declared as a mirror of `runCommand`/`runLoop` (`SystemCompanionRun.swift:~100`, `Commands.swift:129-330`). Cloned logic: the runId recipe, the capability check, transcriber wiring, `watchPermissions`, `serveCaptureRequest`, and the tick-every-4 cadence. `EngineSources` is a parallel of `SystemCaptureSources`. | Duplication | Extract one run-driver step into CaptureAdapters, which both the CLI and the shell call. | ~150 | med | n (a second implementation already exists) |
| L5-12 | MED | Capture-region validation exists three times in Swift: `HostCallDecoder.decodeCapture` (`HostBridge.swift:175-180`), `ScreenWatchDecoder.decodeStart` (`ScreenWatch.swift:253-258`), and the Wire/CaptureRequests decode. TS has two copies: `captureRegionSchema` and `liveCaptureRegionSchema`. Modes also exist twice in TS: `CAPTURE_REQUEST_MODES` and `LIVE_CAPTURE_MODES`. | Duplication | One Swift `CaptureRegion.validated(...)` in CaptureCore. On the TS side, `interview-contracts` re-exports the `active-session-contracts` constants. | 40 | low | n |
| L5-13 | MED | `Wire.swift` (960 lines) hand-mirrors the Zod schemas. Its header claims the schema file is the source, but Swift tests read only `corpus/*.json` examples, never `schema/active-session-wire.schema.json`. Enum parity (IssueCode, RefusalCode, CaptureFailureCode, DisconnectReason, GapReason, media types) is held only by example coverage. TS has an extra issue code `"invalid"` that Swift lacks (`observation.ts:162`). | Missing guard | See G3. | 60 | low | n |
| L5-14 | MED | Strict-concurrency readiness. The `studio-shell` target is pinned to Swift 5 (`Package.swift:50`). Under complete checking there are 59 diagnostics and 1 error: `BridgeHandler`, `StudioWebViewDelegate`, `SignInCoordinator`, `HotkeyCenter` and others have no `@MainActor`. `HotkeyCenter` keeps mutable statics (`onFire`, `bindings`) read from a C callback (`HotkeyCenter.swift:8-9,37-39`). | swift-concurrency refs (`isolation`, `sendable`) | Mark the AppKit/WebKit classes `@MainActor` (the WebKit delegates and handler are main-thread). Replace the statics with a main-actor singleton plus `assumeIsolated`. Then flip the target to v6. | 120 | med | n |
| L5-15 | LOW | Sign-in. `omnitech-studio` is registered in Info.plist (`bundle-app.sh:48`) but there is no URL-open handler. `ASWebAuthenticationSession` does not need the registration, so it only lets other apps launch the shell with that scheme. The redeem URL carries `code` and `state` in a GET query (server answers `no-store` and `no-referrer`, good). `providerHosts` (Google, LinkedIn) is hardcoded in Swift against `configuredLoginProviders` on the server. | Hardening, duplication | Drop `CFBundleURLTypes`. Parity test for the provider hosts. | 8 | low | n |
| L5-16 | LOW | Packaging. Both bundles are ad hoc signed with no hardened runtime and no entitlements file. Notarization would require `--options runtime` and `com.apple.security.device.audio-input`. The companion bundle has no stable designated requirement, unlike the shell (`bundle-app.sh:61`), so TCC and Keychain prompts recur per rebuild. No screen-recording usage string is needed. | Maintainability | Share one `bundle-app` helper with a designated requirement; add an entitlements file when releasing. | 30 | low | n |
| L5-17 | LOW | `KeychainCredentialStore.save` does delete then add (`:44-50`): a failed add loses the old credential. It uses the legacy macOS keychain, with no `kSecUseDataProtectionKeychain`. Service `com.omnitech.capture-companion` is shared by both bundles, so ACL prompts are possible (inferred). | Robustness | Use `SecItemUpdate` with add-on-not-found. | 15 | low | n |
| L5-18 | LOW | Engine decode mismatch. `EngineCallDecoder` accepts `v: true` as version 1 (`EngineBridge.swift:31`, a bare NSNumber check). `HostCallDecoder.number` explicitly rejects Bool. Engine state uses `system-audio` while the request names `application-audio` (a deliberate mapping at `EngineModel.swift:10-22`, with no parity test). | Inconsistency | Reuse `HostCallDecoder.number`. Add test G2. | 10 | low | n |
| L5-19 | LOW | Dead or odd code. `_ = ticket` after the screenWatchStart await (`BridgeHandler.swift:85-89`) does nothing, so screen-watch start is not epoch-gated. Still live per Periphery re-check: `HandsFreeEngine.shutdown` is declared on the protocol only, and `CompanionState.running()/markStopped` and `AppDelegate.timer` are unreferenced or assign-only. `napBlocker` and the observers are intentional retention. Fixed since the baseline: `PresentationHost.swift`, `hasBaseline`, `materialName`, `isExpired`. | Dead code | Delete or gate (confirm each with a grep first). | -40 | low | n |
| L5-20 | LOW | `pinned` is stored as plain `UserDefaults "pinned"` (`ShellModel.swift:60`) while everything else goes through `UserDefaultsStore` with a `shell.` prefix. `StudioLocation.init` uses `StudioLocation(address:"",...)!` as a fallback (`EngineBridge.swift:131`), a force-unwrap that is safe only for the default address. | Inconsistency | Route pinned through `ShellPrefs`. | 6 | low | n |
| L5-21 | LOW | The TS `StudioHostHotkey` still lists legacy `capture-analyze`, which Swift never emits. `"unsupported"` is in `STUDIO_HOST_CAPTURE_FAILURES` and is never produced. | Inconsistency | Prune or comment. | 4 | low | n |

## 3. Duplication map

| Cluster | Locations | Proposed single owner |
|---|---|---|
| JPEG downscale and encode | `ShellCapture.swift:130-157`, `ImageEncoding.swift:34-69` | `CaptureAdapters.ImageEncoder` (public) |
| Frontmost-app tracking | `ShellCapture.swift:31-61`, `SystemCompanionRun.swift:59-86` (`FocusTracker`), `ScreenKitOneShot.sampleFocus` | `FocusTracker` (StudioShellEngine) |
| Companion run loop | `Commands.swift:129-330`, `SystemCompanionRun.swift` (also `SystemCaptureSources` vs `EngineSources`) | A shared run driver in CaptureAdapters |
| Region and mode validation | `HostBridge.swift:175`, `ScreenWatch.swift:253`, Wire.swift CaptureRegion; TS `captureRegionSchema` + `liveCaptureRegionSchema` + two mode lists | CaptureCore (Swift); `active-session-contracts` (TS) |
| 2 MiB screenshot cap | `limits.ts:11`, `live-session.ts:334`, `Limits.swift:7`, `host-adapter.ts:82` (1.8 MB) | `active-session-contracts` limits; the other constants derive from it |
| In-web-view fetch helper | `ShellModel.studioFetch`, `WebViewOwnerRoutes.request` | `WebViewOwnerRoutes` (private world) |
| Tenant slug rule | `Endpoint.swift:92`, `native-handoff.ts:127`, the platform slug schema (not checked) | one TS definition, parity-tested |
| Companion core | `apps/capture-companion/src` (TS) vs `macos/Sources/CaptureCore` | Both kept deliberately (fixture and conformance); guarded only by the corpus |

## 4. Missing mechanical guards

| Rule | Proposed check |
|---|---|
| G1: host capability names, hotkey wire names, hotkey intents (TS `StudioHostHotkey` vs `HostCommand.wireName`), presentation capabilities and app modes | A vitest next to `shortcuts.test.ts` that reads `HostBridge.swift` as text, like the Hotkeys.swift parser. A Swift test reading `studio-host.ts` is the reverse direction. |
| G2: engine enums (pairing stages, source health, start refusals, source names) | Same pattern, in `studio-host.test.ts` or a new `studio-host-swift-parity.test.ts`. |
| G3: wire enums (IssueCode, RefusalCode, CaptureFailureCode, DisconnectReason, GapReason, media types, capture modes, control states) | Make the generated `active-session-wire.schema.json` an input to the Swift tests, or a TS test that regex-parses `Wire.swift` enums. |
| G4: limits | Exists (`LimitsTests.swift`) but is not run by `pnpm verify`; see L5-04. |
| G5: Swift gate | Add `swift build` plus both test harnesses as a `verify:native` step. |
| G6: displayId and capture request shape end to end | A JavaScriptCore test in `BridgeScriptTests` that posts the TS adapter's `captureRequestFor` output through `HostCallDecoder`. |
| G7: provider hosts and the callback scheme | A TS test asserting `NATIVE_CALLBACK_URL` scheme and the Google/LinkedIn hosts against the Swift constants. |
| G8: bridge exposure | No invariant exists. Add a `bridge-answers-only-studio-origin` pin to `bionic/invariants` (Swift test `BridgeTrustTests` is the check). |

## 5. Work packages (ordered)

1. **WP1 Contract fixes** (L5-01/02/03/18/21; `studio-host.ts`, `host-adapter.ts`, `HostBridge.swift`, `EngineBridge.swift`, tests). Depends on L3 owning `interview-contracts` edits. Proof: G1 and G2 tests plus the existing Swift suites.
2. **WP2 Native gate** (L5-04/G5). No code risk. Proof: the command runs from a clean checkout.
3. **WP3 Parity tests** G1, G2, G3, G6, G7 (TS test files plus Swift tests). Fix L5-08 and L5-09 first or alongside.
4. **WP4 Swift dedupe**: L5-10, L5-12, then L5-11. Owns `CaptureAdapters` (public surface) and `apps/studio-shell/Sources/studio-shell`. Proof: the existing `EngineTests` and `ScreenWatchTests`, plus `swift run capture-core-tests`.
5. **WP5 Bridge hardening**: L5-05, L5-06, L5-15, L5-19.
6. **WP6 Concurrency**: L5-14, then flip the target to Swift 6. The most invasive, so last. Proof: `swift build` with 0 diagnostics under complete checking.
7. **WP7 Packaging and Keychain**: L5-16, L5-17, L5-07.

## 6. Already good (do not disturb)

- Both packages build with 0 warnings and are green. The Core / Engine / executable split gives testable decisions, and the shell reuses the companion by package dependency rather than by copy.
- `HostCallDecoder` is strict: exact keys, closed sets, bounded finite numbers, Bool rejected as a number, http(s) only with no user info. `BridgeTrust` checks main frame, the intended web view and the exact scheme, host and port. `BridgeEpoch` drops stale replies after navigation.
- The injected bridge is frozen and non-configurable, injected at document start, and defined only when the handler exists.
- The pairing credential is not on the page bridge. It is fetched in a private content world and stored in the Keychain as `WhenUnlockedThisDeviceOnly`. `IssuedCredential` redacts its description.
- No content logging: only one `NSLog` (window diagnostics), and CLI output is content-free status text.
- The native sign-in handoff is sound: a system web-auth session, a one-time code that carries no token, a state nonce bound to the attempt, a strict callback parser, and a 300 second timeout.
- Browser-only capture gating, region cropping by `sourceRect`, and the display binding are in place.
- Usage strings are present for microphone and speech.
- Parity tests that already exist: `shortcuts.test.ts` against `Hotkeys.swift`, `LimitsTests.swift`, and the corpus tests on both sides.
