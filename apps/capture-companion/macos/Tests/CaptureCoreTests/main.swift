import Foundation

// Runs every test group, prints counts only, and exits non-zero on failure.
let harness = Harness()
await wireTests(harness)
await limitsTests(harness)
await policyTests(harness)
await sessionTests(harness)
await captureRequestTests(harness)
await sourceScanTests(harness)
await credentialAccountTests(harness)
await eventsTests(harness)
await callAudioTests(harness)

for failure in harness.failures { print(failure) }
print("capture-core-tests: \(harness.passed) passed, \(harness.failures.count) failed")
exit(harness.failures.isEmpty ? 0 : 1)
