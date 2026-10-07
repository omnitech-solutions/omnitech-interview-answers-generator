import Foundation
import CaptureCore

private struct CorpusEntry {
    let file: String
    let outcome: String
    let family: String
    let kind: String
    let issueCodes: [String]
}

private func loadManifest() throws -> [CorpusEntry] {
    let url = contractsRoot().appendingPathComponent("corpus/index.json")
    guard case .object(let root)? = JSONValue.parse(try Data(contentsOf: url)),
        case .array(let entries)? = root["entries"]
    else { throw TestError("corpus manifest unreadable") }
    return try entries.map { entry in
        guard case .object(let fields) = entry,
            case .string(let file)? = fields["file"], case .string(let outcome)? = fields["outcome"],
            case .string(let family)? = fields["family"], case .string(let kind)? = fields["kind"]
        else { throw TestError("manifest entry malformed") }
        var codes: [String] = []
        if case .array(let items)? = fields["issueCodes"] {
            for case .string(let code) in items { codes.append(code) }
        }
        return CorpusEntry(file: file, outcome: outcome, family: family, kind: kind, issueCodes: codes)
    }
}

struct TestError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

private func readCorpus(_ file: String) throws -> JSONValue {
    let data = try Data(contentsOf: contractsRoot().appendingPathComponent("corpus/\(file)"))
    guard let json = JSONValue.parse(data) else { throw TestError("\(file) is not JSON") }
    return json
}

@MainActor
func wireTests(_ t: Harness) async {
    let manifest: [CorpusEntry]
    do { manifest = try loadManifest() } catch {
        await t.test("corpus manifest loads") { throw error }
        return
    }

    await t.test("corpus is non-trivial") {
        t.expect(manifest.count >= 50, "manifest has \(manifest.count) entries")
        t.expect(manifest.contains { $0.outcome == "invalid" }, "has invalid entries")
    }

    await t.test("every valid ingest file validates and re-encodes to a structurally equal JSON value") {
        for entry in manifest where entry.outcome == "valid" && entry.family == "ingest" {
            let json = try readCorpus(entry.file)
            switch WireValidator.validateIngest(json) {
            case .ok(let message):
                // Round trip through the deterministic bytes, not just the tree.
                t.expectEqual(JSONValue.parse(message.encoded()), json, entry.file)
            case .failure(let issues):
                t.expect(false, "\(entry.file) refused: \(issues.map { $0.code.rawValue })")
            }
        }
    }

    await t.test("every valid acknowledgement decodes and re-encodes equal") {
        for entry in manifest where entry.outcome == "valid" && entry.family == "acknowledgement" {
            let json = try readCorpus(entry.file)
            switch WireValidator.validateAcknowledgement(json) {
            case .ok(let ack): t.expectEqual(ack.json, json, entry.file)
            case .failure(let issues):
                t.expect(false, "\(entry.file) refused: \(issues.map { $0.code.rawValue })")
            }
        }
    }

    await t.test("every invalid file is refused with exactly the expected issue codes") {
        var checked = 0
        for entry in manifest where entry.outcome == "invalid" {
            guard case .object(let wrapper) = try readCorpus(entry.file), let message = wrapper["message"]
            else { throw TestError("\(entry.file) has no message") }
            let result = WireValidator.validateIngest(message)
            t.expect(result.value == nil, "\(entry.file) was accepted")
            t.expectEqual(result.issueCodes, entry.issueCodes, entry.file)
            checked += 1
        }
        t.expect(checked >= 20, "checked \(checked) invalid files")
    }

    await t.test("refusal codes in the corpus cover every code incl. event_conflict") {
        var seen: Set<String> = []
        for entry in manifest where entry.kind == "acknowledgement.refused" {
            if case .ok(.refused(let code, _, _)) = WireValidator.validateAcknowledgement(try readCorpus(entry.file)) {
                seen.insert(code.rawValue)
            }
        }
        t.expectEqual(seen, Set(RefusalCode.allCases.map(\.rawValue)))
        t.expect(seen.contains("event_conflict"))
    }

    await t.test("identity field names use the contracts normalisation") {
        for name in [
            "tenant", "tenantId", "tenant_id", "Tenant-Id", "userId", "actor", "sessionId",
            "owner", "ACCOUNT", "member_id", "organization", "orgId", "credential", "token", "authorization",
        ] {
            t.expect(WireValidator.isIdentityFieldName(name), name)
        }
        for name in ["authorizationStatus", "sourceId", "speaker", "text", "tokens"] {
            t.expect(!WireValidator.isIdentityFieldName(name), name)
        }
    }

    await t.test("an unknown field, bad version and oversize body are refused by code") {
        var data = Data(
            #"{"version":1,"kind":"heartbeat","sourceId":"a","sentAt":"2026-10-03T10:00:00Z","capturing":true,"x":1}"#
                .utf8)
        t.expectEqual(WireValidator.validateIngest(data: data).issueCodes, ["unknown_field"])
        data = Data(
            #"{"version":2,"kind":"heartbeat","sourceId":"a","sentAt":"2026-10-03T10:00:00Z","capturing":true}"#.utf8)
        t.expectEqual(WireValidator.validateIngest(data: data).issueCodes, ["unsupported_version"])
        data = Data(repeating: 0x20, count: ActiveSessionLimits.maxEnvelopeBytes + 1)
        t.expectEqual(WireValidator.validateIngest(data: data).issueCodes, ["too_large"])
        t.expectEqual(WireValidator.validateIngest(data: Data("[]".utf8)).issueCodes, ["invalid_type"])
        t.expectEqual(WireValidator.validateIngest(data: Data("nope".utf8)).issueCodes, ["invalid_type"])
    }

    await t.test("the encoder is deterministic with sorted keys") {
        let beat = Heartbeat(sourceId: "a", sentAt: "2026-10-03T10:00:00Z", capturing: false)
        t.expectEqual(
            String(decoding: IngestMessage.heartbeat(beat).encoded(), as: UTF8.self),
            #"{"capturing":false,"kind":"heartbeat","sentAt":"2026-10-03T10:00:00Z","sourceId":"a","version":1}"#)
    }

    await t.test("no wire field is named like an identity") {
        // The encoder never emits an identity-shaped key for any corpus message.
        @MainActor func scan(_ value: JSONValue) {
            switch value {
            case .object(let fields):
                for (key, child) in fields {
                    t.expect(!WireValidator.isIdentityFieldName(key), "encoded key \(key)")
                    scan(child)
                }
            case .array(let items): items.forEach(scan)
            default: break
            }
        }
        for entry in manifest where entry.outcome == "valid" && entry.family == "ingest" {
            if case .ok(let message) = WireValidator.validateIngest(try readCorpus(entry.file)) { scan(message.json) }
        }
    }
}
