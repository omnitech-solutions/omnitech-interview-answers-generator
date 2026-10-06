# SWIFT worker report: SW-ARC-02 and SW-SEC-01

## SW-SEC-01 (done)
- New `apps/studio-shell/Sources/StudioShellCore/NavigationPolicy.swift`: `NavigationDecision` (`allow(startsNewPage:)`, `cancel`, `requestSignIn`, `showSignIn`, `openExternally`), `NavigationPolicy.decide(url:isMainFrame:location:)` and `NavigationPolicy.mediaCaptureAllowed(originScheme:host:port:isMainFrame:location:)`.
- `StudioWebView.swift`: `decidePolicyFor` now switches on the decision; the side effects (sign-in request, panel load, epoch advance, opening the browser) are unchanged. `requestMediaCapturePermissionFor` calls `mediaCaptureAllowed`. Same order of checks as before: start link, then main-frame sign-in page or provider, then Studio origin or `about:`, else external.
- Tests first: `Tests/StudioShellTests/NavigationPolicyTests.swift` (registered in `main.swift`) failed to compile before the extraction. It pins: exact scheme/host/port only (default port and case folded), other origins external, sign-in page and Google/LinkedIn providers show sign-in in the main frame only, look-alike hosts external, start link in any frame and without a location, `about:` allowed, no location means nothing but the start link is allowed, nil URL cancelled, media capture refused for other origin/scheme/port/look-alike/subframe/no location.
- Behaviour kept as-is (worth knowing): a sign-in page in a subframe is allowed as a Studio page; a provider URL in a subframe opens externally; `about:` is refused when no location is set.

## SW-ARC-02 (done: comments at every site; two findings)
Written invariant and removal plan at: `DeadlineRace` (TextRecognition.swift), `RequestBox` (VisionTextObserver.swift), `EngineSources` (SystemCompanionRun.swift), `ScreenKitSource`, `Generation` (SystemCaptureSources.swift), `MicrophoneCapture`, `Box` and `ImageBox` (ShareableContentFetch.swift), `OnDeviceTranscriber` (OnDeviceSpeech.swift), plus the test-only `Flag` (CaptureRequestTests.swift).
- Removed one: `EventBox` is now `@MainActor private final class` (its only property was already main-actor isolated), so it is Sendable by isolation. Compiles in Swift 6 mode.
- Hold: `DeadlineRace`, `Generation`, `RequestBox` (lock-guarded), `OnDeviceTranscriber` (queue-confined), `EngineSources` (lets plus locked counter), `Box`/`ImageBox` (single immutable let, handed over once).
- FINDING 1 (false invariant, not fixed): `ScreenKitSource`'s old comment said `sampleQueue` owns all mutable state. `stream` is read/written by `start()`/`stop()` on arbitrary executors, unguarded, and callers launch them in unordered `Task`s (`SystemCaptureSources`, `EngineSources`), so a quick stop can miss the stream or race. `label` is written in `start()` and read on `sampleQueue` (ordered in practice by `startCapture`). A fix needs a lock or actor and a ScreenCaptureKit double to test, so it was not done; comment corrected.
- FINDING 2 (not fixed): `MicrophoneCapture.engine`/`observer` are unguarded across `start()` (async) and `stop()` (sync from another context); same unordered `Task` launch. The audio-thread tap itself captures only immutable copies. Comment says so.
- UNVERIFIED: `VNRequest.cancel()` called from another thread (Apple does not state thread safety); `SCShareableContent` and `CGImage` Sendable status in the installed SDK.

## Runs
- `cd apps/studio-shell && swift build --product studio-shell-tests && swift run studio-shell-tests`: 159 passed, 0 failed (includes the new group).
- `swift build -c release` in `apps/studio-shell`: Build complete.
- `apps/capture-companion/macos`: `swift build` complete; `swift run capture-core-tests`: 63 passed, 0 failed.
- No warnings were looked at beyond errors; `pnpm verify` not run (lead's).

## Wave 2 / ADR
No ADR needed. Findings 1 and 2 are candidates for a small follow-up: serialise adapter start/stop (actor or lock) with a fake-source test.
