import CaptureCore
import Foundation

// [DOMAIN] The native half of the host adapter contract
// (packages/interview-contracts/src/studio-host.ts, ADR-0019). The page calls
// `window.studioHost.<method>(…)`; the injected script turns each call into one
// message `{v, method, params}` and the shell answers with a plain value.
// Version and capability names here must match that TypeScript file.

public enum HostBridge {
    public static let version = 1
    public static let hostKind = "native-macos"
    public static let handlerName = "studioHost"
}

public enum HostCapability: String, CaseIterable, Sendable {
    case captureScreen = "capture-screen"
    case pinOnTop = "pin-on-top"
    case hotkeys
    case openExternal = "open-external"
}

public enum HostCommand: String, Sendable {
    case captureAnalyze = "capture-analyze"
}

public enum HostCall: Equatable, Sendable {
    case captureScreen(CaptureRequest)
    case pinOnTop(Bool)
    case openExternal(URL)
}

public enum HostCallError: Error, Equatable, Sendable {
    case malformed
    case unsupportedVersion
    case unknownMethod
    case invalidParameters
}

public enum HostCallDecoder {
    // [GUARD] Everything the page sends is untrusted: only a dictionary at the
    // version we speak, naming a method we know, with parameters of exactly the
    // expected shape. A region is finite, inside the unit square, and present
    // exactly when the mode is "region"; an address is http(s) with no user info.
    public static func decode(_ body: Any, requestId: String = UUID().uuidString) -> Result<HostCall, HostCallError> {
        guard let message = body as? [String: Any] else { return .failure(.malformed) }
        guard let version = number(message["v"]), version == Double(HostBridge.version) else {
            return .failure(.unsupportedVersion)
        }
        guard let method = message["method"] as? String else { return .failure(.malformed) }
        let params = message["params"] as? [String: Any] ?? [:]
        switch method {
        case "captureScreen": return decodeCapture(params, requestId: requestId)
        case "pinOnTop":
            guard let pinned = params["pinned"] as? Bool else { return .failure(.invalidParameters) }
            return .success(.pinOnTop(pinned))
        case "openExternal":
            guard let text = params["url"] as? String, let url = externalURL(text) else {
                return .failure(.invalidParameters)
            }
            return .success(.openExternal(url))
        default: return .failure(.unknownMethod)
        }
    }

    private static func decodeCapture(_ params: [String: Any], requestId: String) -> Result<HostCall, HostCallError> {
        guard let modeText = params["mode"] as? String, let mode = CaptureMode(rawValue: modeText) else {
            return .failure(.invalidParameters)
        }
        let rawRegion = params["region"]
        guard mode == .region else {
            return rawRegion == nil || rawRegion is NSNull
                ? .success(.captureScreen(CaptureRequest(requestId: requestId, mode: mode)))
                : .failure(.invalidParameters)
        }
        guard let fields = rawRegion as? [String: Any],
            let x = number(fields["x"]), let y = number(fields["y"]),
            let width = number(fields["width"]), let height = number(fields["height"]),
            [x, y, width, height].allSatisfy({ $0.isFinite }),
            x >= 0, y >= 0, width > 0, height > 0, x + width <= 1, y + height <= 1
        else { return .failure(.invalidParameters) }
        return .success(.captureScreen(CaptureRequest(
            requestId: requestId, mode: .region,
            region: CaptureRegion(x: x, y: y, width: width, height: height))))
    }

    // JavaScript numbers arrive as NSNumber; Bool is an NSNumber too and is not a number here.
    private static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        return number.doubleValue
    }

    public static func externalURL(_ text: String) -> URL? {
        guard text.count <= 2048, let url = URL(string: text), let scheme = url.scheme?.lowercased(),
            scheme == "https" || scheme == "http", url.host?.isEmpty == false,
            url.user == nil, url.password == nil
        else { return nil }
        return url
    }
}

public enum HostReply {
    public static func capture(_ outcome: CaptureOutcome, screenAccessGranted: Bool) -> [String: Any] {
        switch outcome {
        case .image(let jpeg, _):
            // The application name stays here: the page labels a frame by kind only.
            return ["ok": true, "mediaType": "image/jpeg", "base64": jpeg.base64EncodedString()]
        case .lost(let loss):
            if !screenAccessGranted { return failure("permission-denied") }
            return failure(loss == .noFocusedWindow ? "no-focused-window" : "capture-failed")
        }
    }

    public static func failure(_ reason: String) -> [String: Any] { ["ok": false, "reason": reason] }
    public static func pinned(_ pinned: Bool) -> Bool { pinned }
}

// The script a WKUserScript injects into the main frame at document start. It
// defines a frozen `window.studioHost` that forwards each call to the native
// handler (a promise-returning `webkit.messageHandlers.studioHost`) and an event
// entry the shell calls for a hotkey. Page scripts can read it and call it; they
// cannot reach anything the shell has not decoded and bounded above.
public enum HostBridgeScript {
    public static func source(capabilities: [HostCapability]) -> String {
        let names = capabilities.map { "\"\($0.rawValue)\"" }.joined(separator: ",")
        return """
        (function () {
          if (window.studioHost) return;
          var handler = window.webkit && window.webkit.messageHandlers
            && window.webkit.messageHandlers.\(HostBridge.handlerName);
          if (!handler) return;
          var listeners = [];
          function call(method, params) {
            return handler.postMessage({ v: \(HostBridge.version), method: method, params: params || {} });
          }
          var host = {
            version: \(HostBridge.version),
            hostKind: "\(HostBridge.hostKind)",
            capabilities: Object.freeze([\(names)]),
            captureScreen: function (request) { return call("captureScreen", request); },
            pinOnTop: function (pinned) { return call("pinOnTop", { pinned: !!pinned }); },
            openExternal: function (url) { return call("openExternal", { url: String(url) }); },
            onHotkey: function (listener) {
              if (typeof listener !== "function") return function () {};
              listeners.push(listener);
              return function () { listeners = listeners.filter(function (each) { return each !== listener; }); };
            }
          };
          Object.defineProperty(window, "studioHost", { value: Object.freeze(host), configurable: false });
          Object.defineProperty(window, "__studioHostEmit", {
            value: function (name) {
              listeners.slice().forEach(function (listener) { try { listener(String(name)); } catch (e) {} });
            },
            configurable: false
          });
        })();
        """
    }

    // The call the shell evaluates in the page for a hotkey.
    public static func emit(_ command: HostCommand) -> String {
        "window.__studioHostEmit && window.__studioHostEmit(\"\(command.rawValue)\");"
    }
}
