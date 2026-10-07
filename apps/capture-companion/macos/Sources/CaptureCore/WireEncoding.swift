import Foundation

// [DOMAIN] Deterministic encoding of the wire messages: typed value to JSON tree
// to sorted-key bytes. Optional fields are omitted, never null, so a resend of
// the same observation is byte-identical (rule:idempotent-observation).

extension Observation {
    public var json: JSONValue {
        var fields: [String: JSONValue] = [
            "version": .number(Double(wireVersion)),
            "sourceId": .string(envelope.sourceId),
            "eventId": .string(envelope.eventId),
            "occurredAt": .string(envelope.occurredAt),
            "sequence": .number(Double(envelope.sequence)),
        ]
        switch body {
        case .transcriptFinal(let content):
            fields["kind"] = .string("transcript.final")
            var inner: [String: JSONValue] = [
                "speaker": .string(content.speaker),
                "text": .string(content.text),
                "startMs": .number(Double(content.startMs)),
                "endMs": .number(Double(content.endMs)),
            ]
            if let source = content.source { inner["source"] = .string(source.rawValue) }
            if let supersedes = content.supersedes { inner["supersedes"] = .string(supersedes) }
            fields["content"] = .object(inner)
        case .screenSnapshot(let content):
            fields["kind"] = .string("screen.snapshot")
            var inner: [String: JSONValue] = [
                "payloadRef": .string(content.payloadRef),
                "mediaType": .string(content.mediaType.rawValue),
                "byteLength": .number(Double(content.byteLength)),
                "windowLabel": .string(content.windowLabel),
            ]
            if let requestId = content.requestId { inner["requestId"] = .string(requestId) }
            fields["content"] = .object(inner)
        case .sourceDisconnected(let source, let reason):
            fields["kind"] = .string("source.disconnected")
            fields["content"] = .object([
                "source": .string(source.rawValue), "reason": .string(reason.rawValue),
            ])
        case .captureGap(let source, let durationMs, let reason):
            fields["kind"] = .string("capture.gap")
            fields["content"] = .object([
                "source": .string(source.rawValue),
                "durationMs": .number(Double(durationMs)),
                "reason": .string(reason.rawValue),
            ])
        }
        return .object(fields)
    }
}

extension Heartbeat {
    public var json: JSONValue {
        var object: [String: JSONValue] = [
            "version": .number(Double(wireVersion)),
            "kind": .string("heartbeat"),
            "sourceId": .string(sourceId),
            "sentAt": .string(sentAt),
            "capturing": .bool(capturing),
        ]
        if let diagnostics {
            var block: [String: JSONValue] = [
                "state": .string(diagnostics.state),
                "sources": .object(diagnostics.sources.mapValues { .string($0) }),
            ]
            if let failure = diagnostics.speechFailure { block["speechFailure"] = .string(failure) }
            object["diagnostics"] = .object(block)
        }
        return .object(object)
    }
}

extension CapabilityReport {
    public var json: JSONValue {
        .object([
            "version": .number(Double(wireVersion)),
            "kind": .string("capability.report"),
            "sourceId": .string(sourceId),
            "sentAt": .string(sentAt),
            "speech": .object([
                "locale": .string(speech.locale),
                "onDeviceAvailable": .bool(speech.onDeviceAvailable),
                "recognizerAvailable": .bool(speech.recognizerAvailable),
                "authorizationStatus": .string(speech.authorizationStatus.rawValue),
            ]),
            "permissions": .object([
                "microphone": .string(microphone.rawValue), "screen": .string(screen.rawValue),
            ]),
        ])
    }
}

extension CaptureFailure {
    public var json: JSONValue {
        .object([
            "version": .number(Double(wireVersion)),
            "kind": .string("capture.failure"),
            "sourceId": .string(sourceId),
            "sentAt": .string(sentAt),
            "requestId": .string(requestId),
            "code": .string(code.rawValue),
        ])
    }
}

extension IngestMessage {
    public var json: JSONValue {
        switch self {
        case .observation(let observation): return observation.json
        case .heartbeat(let heartbeat): return heartbeat.json
        case .capabilityReport(let report): return report.json
        case .captureFailure(let failure): return failure.json
        }
    }

    public func encoded() -> Data { json.canonicalData() }
}

extension CaptureRequest {
    var json: JSONValue {
        var fields: [String: JSONValue] = [
            "requestId": .string(requestId), "mode": .string(mode.rawValue),
            "expiresAt": .string(expiresAt),
        ]
        if let selection { fields["selection"] = .string(selection) }
        if let region {
            fields["region"] = .object([
                "x": .number(region.x), "y": .number(region.y),
                "width": .number(region.width), "height": .number(region.height),
            ])
        }
        return .object(fields)
    }
}

extension ControlStatus {
    var json: JSONValue {
        var fields: [String: JSONValue] = [
            "state": .string(state.rawValue), "credentialExpiresAt": .string(credentialExpiresAt),
        ]
        if let capture { fields["capture"] = capture.json }
        return .object(fields)
    }
}

extension AcceptedAck {
    var json: JSONValue {
        .object([
            "version": .number(Double(wireVersion)),
            "status": .string("accepted"),
            "sourceId": .string(sourceId),
            "eventId": .string(eventId),
            "control": control.json,
        ])
    }
}

extension Acknowledgement {
    public var json: JSONValue {
        switch self {
        case .accepted(let ack): return ack.json
        case .duplicate(let original):
            return .object([
                "version": .number(Double(wireVersion)), "status": .string("duplicate"),
                "original": original.json,
            ])
        case .refused(let code, let control, let issues):
            var fields: [String: JSONValue] = [
                "version": .number(Double(wireVersion)), "status": .string("refused"),
                "code": .string(code.rawValue),
            ]
            if let control { fields["control"] = control.json }
            if let issues {
                fields["issues"] = .array(
                    issues.map { issue in
                        .object([
                            "path": .array(
                                issue.path.map { part in
                                    switch part {
                                    case .key(let key): return .string(key)
                                    case .index(let index): return .number(Double(index))
                                    }
                                }),
                            "code": .string(issue.code),
                        ])
                    })
            }
            return .object(fields)
        }
    }
}
