import Foundation

// Runs every test group, prints counts only, and exits non-zero on failure.
let harness = Harness()
await locationTests(harness)
await pairingTests(harness)
await bridgeDecodeTests(harness)
await bridgeScriptTests(harness)
await stateTests(harness)
await nativeSignInTests(harness)
await bridgeTrustTests(harness)
await presentationTests(harness)
await hitRegionTests(harness)
await engineTests(harness)
await screenWatchTests(harness)
await browserFocusTests(harness)
await captureTargetTests(harness)
await studioWebFetchTests(harness)
await textRecognitionTests(harness)
await captureDisplayTests(harness)
await navigationPolicyTests(harness)

for failure in harness.failures { print(failure) }
print("studio-shell-tests: \(harness.passed) passed, \(harness.failures.count) failed")
exit(harness.failures.isEmpty ? 0 : 1)
