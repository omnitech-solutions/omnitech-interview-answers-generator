import Foundation

// Runs every test group, prints counts only, and exits non-zero on failure.
let harness = Harness()
await locationTests(harness)
await pairingTests(harness)
await bridgeDecodeTests(harness)
await bridgeScriptTests(harness)
await stateTests(harness)

for failure in harness.failures { print(failure) }
print("studio-shell-tests: \(harness.passed) passed, \(harness.failures.count) failed")
exit(harness.failures.isEmpty ? 0 : 1)
