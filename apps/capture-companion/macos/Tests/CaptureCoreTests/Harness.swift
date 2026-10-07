import Foundation

// [DOMAIN] A tiny assertion harness. The Command Line Tools toolchain ships
// neither Swift Testing nor XCTest, so CaptureCore's tests are an executable
// (`swift run capture-core-tests`) that exits non-zero when any check fails.
@MainActor
final class Harness {
    private(set) var passed = 0
    private(set) var failures: [String] = []
    private var currentTest = ""
    private var currentFailed = false

    func test(_ name: String, _ body: () async throws -> Void) async {
        currentTest = name
        currentFailed = false
        do { try await body() } catch {
            record("threw \(error)")
        }
        if !currentFailed { passed += 1 }
    }

    func expect(
        _ condition: Bool, _ message: @autoclosure () -> String = "expectation failed", line: UInt = #line,
        file: String = #fileID
    ) {
        if !condition { record("\(message()) (\(file):\(line))") }
    }

    func expectEqual<T: Equatable>(
        _ actual: T, _ expected: T, _ label: String = "", line: UInt = #line, file: String = #fileID
    ) {
        if actual != expected {
            record("\(label) expected \(expected) but got \(actual) (\(file):\(line))")
        }
    }

    private func record(_ message: String) {
        currentFailed = true
        failures.append("FAIL \(currentTest): \(message)")
    }
}

// The repository root, found from this file's path: Tests/CaptureCoreTests/<file>
// is six components below it.
func repositoryRoot(from file: String = #filePath) -> URL {
    var url = URL(fileURLWithPath: file)
    for _ in 0..<6 { url.deleteLastPathComponent() }
    return url
}

func contractsRoot() -> URL {
    repositoryRoot().appendingPathComponent("packages/active-session-contracts")
}
