import Foundation

// [DOMAIN] The same tiny assertion harness as the capture companion's: the
// Command Line Tools toolchain ships neither Swift Testing nor XCTest, so these
// tests are an executable (`swift run studio-shell-tests`) that exits non-zero
// when any check fails.
@MainActor
final class Harness {
    private(set) var passed = 0
    private(set) var failures: [String] = []
    private var currentTest = ""
    private var currentFailed = false

    func test(_ name: String, _ body: () async throws -> Void) async {
        currentTest = name
        currentFailed = false
        do { try await body() } catch { record("threw \(error)") }
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
        if actual != expected { record("\(label) expected \(expected) but got \(actual) (\(file):\(line))") }
    }

    private func record(_ message: String) {
        currentFailed = true
        failures.append("FAIL \(currentTest): \(message)")
    }
}
