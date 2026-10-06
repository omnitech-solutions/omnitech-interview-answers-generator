import CaptureAdapters
import CaptureCore
import Foundation
import StudioShellCore
import WebKit

// [DOMAIN] The engine's slice of the host adapter (ADR-0019): Studio's page
// issues typed commands through `window.studioHost.engine`, the native side
// executes and answers, and state changes come back as typed events. The
// credential is obtained natively and never crosses this bridge. Method names
// and shapes must match the `engine` part of
// packages/interview-contracts/src/studio-host.ts.
public enum EngineCall: Equatable, Sendable {
    case start(sessionId: String, sources: Set<CaptureSource>)
    case stop
    case pause
    case resume
    case status
}

public enum EngineCallDecoder {
    public static let methods: Set<String> = ["engineStart", "engineStop", "enginePause", "engineResume", "engineStatus"]

    // nil: not an engine method (let the main decoder handle it).
    // [GUARD] Everything the page sends is untrusted: exactly the expected keys,
    // a session id that is a UUID, and at most the three known sources.
    public static func decode(_ body: Any) -> Result<EngineCall, HostCallError>? {
        guard let message = body as? [String: Any], let method = message["method"] as? String, methods.contains(method)
        else { return nil }
        guard Set(message.keys).isSubset(of: ["v", "method", "params"]),
            let version = message["v"] as? NSNumber, version.intValue == HostBridge.version
        else { return .failure(.malformed) }
        let params = message["params"] as? [String: Any] ?? [:]
        switch method {
        case "engineStart":
            guard Set(params.keys) == ["sessionId", "sources"], let id = params["sessionId"] as? String,
                id.count <= 64, UUID(uuidString: id) != nil, let names = params["sources"] as? [String],
                names.count <= 3
            else { return .failure(.invalidParameters) }
            let sources = Set(names.compactMap(CaptureSource.init(rawValue:)))
            guard sources.count == names.count else { return .failure(.invalidParameters) }
            return .success(.start(sessionId: id, sources: sources))
        default:
            guard params.isEmpty else { return .failure(.invalidParameters) }
            switch method {
            case "engineStop": return .success(.stop)
            case "enginePause": return .success(.pause)
            case "engineResume": return .success(.resume)
            default: return .success(.status)
            }
        }
    }
}

public enum EngineBridge {
    // Executes one decoded call and returns the plain reply for the page.
    @MainActor
    public static func perform(_ call: EngineCall, on host: EngineHost) async -> [String: Any] {
        switch call {
        case .start(let id, let sources):
            switch await host.start(sessionId: id, sources: sources) {
            case .ok: return status(host)
            case .refused(let reason): return ["ok": false, "reason": reason.rawValue]
            }
        case .stop:
            await host.stop()
            return status(host)
        case .pause:
            await host.pause()
            return status(host)
        case .resume:
            await host.resume()
            return status(host)
        case .status: return status(host)
        }
    }

    @MainActor
    public static func status(_ host: EngineHost) -> [String: Any] {
        ["ok": true, "engine": host.snapshot.bridgeValue]
    }

    // The script the shell evaluates in the page for a state change.
    public static func emitScript(_ snapshot: EngineSnapshot) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: snapshot.bridgeValue),
            let json = String(data: data, encoding: .utf8)
        else { return nil }
        return "window.__studioHostEngineEmit && window.__studioHostEngineEmit(\(json));"
    }

    // Splice into HostBridgeScript's host object: `engine: <this>`.
    public static let pageObjectSource = """
    Object.freeze({
      start: function (request) { return call("engineStart", { sessionId: String(request && request.sessionId), sources: (request && request.sources) || [] }); },
      stop: function () { return call("engineStop"); },
      pause: function () { return call("enginePause"); },
      resume: function () { return call("engineResume"); },
      status: function () { return call("engineStatus"); },
      onEvent: function (listener) {
        if (typeof listener !== "function") return function () {};
        engineListeners.push(listener);
        return function () { engineListeners = engineListeners.filter(function (each) { return each !== listener; }); };
      }
    })
    """

    // Defined next to `listeners` in the script; the emit entry the shell calls.
    public static let pageEmitSource = """
    Object.defineProperty(window, "__studioHostEngineEmit", {
      value: function (state) {
        engineListeners.slice().forEach(function (listener) { try { listener(state); } catch (e) {} });
      },
      configurable: false
    });
    """
}

public enum SystemEngine {
    // The production engine over the signed-in web view, the Keychain and the
    // companion session. `location` is read at use, so a rebind is honoured.
    @MainActor
    public static func make(
        webView: @escaping () -> WKWebView?, location: @escaping () -> StudioLocation?
    ) -> HandsFreeEngine {
        // The engine's own session credential, scoped to this build's code identity (see
        // CredentialAccount); the pairing the person pastes stays in the shared item.
        let credentials = KeychainCredentialStore.forThisBuild()
        let focus = FocusTracker()
        return HandsFreeEngine(
            routes: WebViewOwnerRoutes(webView: webView, location: location), credentials: credentials,
            clock: SystemClock()
        ) { plan in
            let fallback = StudioLocation(address: "", tenantSlug: "local")!
            return SystemCompanionRun(
                plan: plan, endpoint: (location() ?? fallback).endpoint, credentials: credentials, focus: focus)
        }
    }
}
