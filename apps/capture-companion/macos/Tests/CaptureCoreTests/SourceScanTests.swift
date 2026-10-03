import Foundation

// [SAFETY] Static guarantees about what the Swift sources can do. These scans
// stand in for a SAST tool: they are cheap, grep-able, and fail loudly when a
// forbidden capability appears (rule:locality-by-stage, rule:id-only-traces,
// rule:credential-storage).

private struct SourceFile {
    let name: String
    let text: String
    // Source with line comments removed, so a comment never trips or hides a scan.
    var code: String {
        text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { line -> String in
                if let range = line.range(of: "//") { return String(line[..<range.lowerBound]) }
                return String(line)
            }.joined(separator: "\n")
    }
    var imports: Set<String> {
        Set(code.split(separator: "\n").compactMap { line -> String? in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("import ") else { return nil }
            return String(trimmed.dropFirst(7))
        })
    }
}

private func sources(in directory: String) throws -> [SourceFile] {
    let root = repositoryRoot().appendingPathComponent("apps/capture-companion/macos/\(directory)")
    let names = try FileManager.default.contentsOfDirectory(atPath: root.path).filter { $0.hasSuffix(".swift") }.sorted()
    return try names.map { SourceFile(name: $0, text: try String(contentsOf: root.appendingPathComponent($0), encoding: .utf8)) }
}

private let loggingNames = ["print(", "debugPrint(", "NSLog(", "os_log", "Logger(", "dump(", "FileHandle.standardError"]
private let secretNames = ["DATABASE_URL", "postgres", "OPENAI", "ANTHROPIC", "OPENROUTER", "sk-"]

@MainActor
func sourceScanTests(_ t: Harness) async {
    await t.test("CaptureCore imports only Foundation and CryptoKit and has no framework or logging") {
        let core = try sources(in: "Sources/CaptureCore")
        t.expect(core.count >= 10)
        for file in core {
            t.expect(file.imports.isSubset(of: ["Foundation", "CryptoKit"]), "\(file.name) imports \(file.imports)")
            for name in loggingNames { t.expect(!file.code.contains(name), "\(file.name) uses \(name)") }
            for name in secretNames { t.expect(!file.code.contains(name), "\(file.name) mentions \(name)") }
            for name in ["ScreenCaptureKit", "SFSpeech", "AVAudio", "URLSession", "SecItem"] {
                t.expect(!file.code.contains(name), "\(file.name) reaches the framework \(name)")
            }
        }
    }

    await t.test("Core has no API that could enable remote recognition") {
        for file in try sources(in: "Sources/CaptureCore") {
            for name in ["requiresOnDeviceRecognition", "allowRemote", "remoteRecognition", "serverRecognition", "useServer", "SFSpeechRecognizer"] {
                t.expect(!file.text.contains(name), "\(file.name) contains \(name)")
            }
        }
    }

    await t.test("adapters import only the permitted frameworks and never log or name secrets") {
        let allowed: Set<String> = [
            "Foundation", "CaptureCore", "ScreenCaptureKit", "Speech", "AVFoundation", "CoreMedia",
            "CoreImage", "CoreGraphics", "ImageIO", "Security", "Dispatch", "CaptureAdapters",
        ]
        let adapters = try sources(in: "Sources/CaptureAdapters") + sources(in: "Sources/capture-companion")
        t.expect(adapters.count >= 6, "found \(adapters.count) adapter files")
        for file in adapters {
            t.expect(file.imports.isSubset(of: allowed), "\(file.name) imports \(file.imports.subtracting(allowed))")
            for name in secretNames { t.expect(!file.code.contains(name), "\(file.name) mentions \(name)") }
            for name in ["NSLog(", "os_log", "Logger(", "debugPrint(", "dump("] {
                t.expect(!file.code.contains(name), "\(file.name) uses \(name)")
            }
        }
    }

    await t.test("speech recognition is always on-device and the speech adapter has no network type") {
        let adapters = try sources(in: "Sources/CaptureAdapters")
        let speech = adapters.filter { $0.code.contains("SFSpeechRecognizer") }
        t.expect(!speech.isEmpty, "a speech adapter exists")
        for file in adapters {
            t.expect(!file.code.contains("requiresOnDeviceRecognition = false"), "\(file.name) allows server recognition")
            t.expect(!file.code.contains("SFSpeechURLRecognitionRequest"), "\(file.name) uses a URL recognition request")
        }
        for file in speech {
            t.expect(file.code.contains("requiresOnDeviceRecognition = true"), "\(file.name) must require on-device recognition")
            for name in ["URLSession", "URLRequest", "URLConnection", "NWConnection", "Network"] {
                t.expect(!file.code.contains(name), "\(file.name) names the network type \(name)")
            }
        }
    }

    await t.test("transport is ephemeral with no cookies, cache or logging; Keychain is this-device-only") {
        let adapters = try sources(in: "Sources/CaptureAdapters")
        let transport = adapters.filter { $0.code.contains("URLSession") }
        t.expect(!transport.isEmpty, "a URLSession transport exists")
        for file in transport {
            for needed in [".ephemeral", "httpCookieStorage = nil", "urlCache = nil", "httpShouldSetCookies = false"] {
                t.expect(file.code.contains(needed), "\(file.name) lacks \(needed)")
            }
            t.expect(!file.code.contains("URLSession.shared"), "\(file.name) uses the shared session")
        }
        let keychain = adapters.filter { $0.code.contains("SecItem") }
        t.expect(!keychain.isEmpty, "a Keychain store exists")
        for file in keychain {
            t.expect(file.code.contains("kSecClassGenericPassword"), file.name)
            t.expect(file.code.contains("kSecAttrAccessibleWhenUnlockedThisDeviceOnly"), file.name)
            t.expect(!file.code.contains("kSecAttrSynchronizable"), "\(file.name) must not sync the credential")
        }
    }

    await t.test("the executable prints only static status strings, ids and counts") {
        for file in try sources(in: "Sources/capture-companion") {
            for line in file.code.split(separator: "\n") where line.contains("print(") {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                t.expect(trimmed.contains("print(Status."), "\(file.name): \(trimmed)")
            }
        }
    }
}
