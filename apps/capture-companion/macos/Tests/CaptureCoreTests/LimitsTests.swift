import Foundation
import CaptureCore

// Parses `name: 4 * 60 * 1_000,` lines out of limits.ts and compares them.
@MainActor
func limitsTests(_ t: Harness) async {
    await t.test("Swift limits equal ACTIVE_SESSION_LIMITS in limits.ts") {
        let url = contractsRoot().appendingPathComponent("src/limits.ts")
        let source = try String(contentsOf: url, encoding: .utf8)
        var parsed: [String: Int] = [:]
        for line in source.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.hasPrefix("//"), let colon = trimmed.firstIndex(of: ":"), trimmed.hasSuffix(",")
            else { continue }
            let name = String(trimmed[..<colon])
            let expression = trimmed[trimmed.index(after: colon)...].dropLast()
            var product = 1
            var valid = true
            for factor in expression.split(separator: "*") {
                if let number = Int(factor.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "_", with: ""))
                {
                    product *= number
                } else {
                    valid = false
                }
            }
            if valid { parsed[name] = product }
        }
        t.expect(parsed.count >= 12, "parsed \(parsed.count) limits")
        t.expectEqual(parsed, ActiveSessionLimits.all)
    }
}
