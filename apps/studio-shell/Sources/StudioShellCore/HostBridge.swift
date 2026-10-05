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
    case screenWatch = "screen-watch"
}

// [DOMAIN] An intent the shell sends to the pages. The page decides what it
// means; the shell runs no workflow of its own.
public enum HostCommand: Equatable, Sendable {
    case autoToggle
    case captureAnalyze
    case solutionGenerate
    case transcribeToggle
    case skillNext
    case skillPrevious
    case sessionClear
    // Put the cursor in the chat input; the page owns the input.
    case chatFocus

    // The typed command names pages subscribe to (`onHotkey`).
    public var wireName: String {
        switch self {
        case .autoToggle: "auto.toggle"
        case .captureAnalyze: "capture.analyze"
        case .solutionGenerate: "solution.generate"
        case .transcribeToggle: "transcribe.toggle"
        case .skillNext: "skill.next"
        case .skillPrevious: "skill.prev"
        case .sessionClear: "session.clear"
        case .chatFocus: "chat.focus"
        }
    }
}

public enum HostCall: Equatable, Sendable {
    // displayId binds a region to the display it was defined for (nil: the main display, as before).
    case captureScreen(CaptureRequest, displayId: UInt32?)
    case pinOnTop(Bool)
    case openExternal(URL)
    // The typed presentation commands (window.studioHost.presentation).
    case presentation(PresentationCommand)
    // window.studioHost.screenWatch: Studio decides, the shell only watches.
    case screenWatchStart(ScreenWatchRequest)
    case screenWatchStop
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
        guard let message = body as? [String: Any], Set(message.keys).isSubset(of: ["v", "method", "params"]) else {
            return .failure(.malformed)
        }
        guard let version = number(message["v"]), version == Double(HostBridge.version) else {
            return .failure(.unsupportedVersion)
        }
        guard let method = message["method"] as? String, method.count <= 32 else { return .failure(.malformed) }
        let params = message["params"] as? [String: Any] ?? [:]
        // [GUARD] Each method takes exactly its own keys; an extra key is a refusal, not ignored.
        let allowed: Set<String>
        switch method {
        case "captureScreen": allowed = ["mode", "region", "displayId"]
        case "pinOnTop": allowed = ["pinned"]
        case "openExternal": allowed = ["url"]
        case "presentation": allowed = ["op", "visible", "on", "mode", "enabled", "width", "height"]
        case "screenWatchStart": allowed = ["mode", "region", "displayId", "intervalMs"]
        case "screenWatchStop": allowed = []
        default: return .failure(.unknownMethod)
        }
        guard Set(params.keys).isSubset(of: allowed) else { return .failure(.invalidParameters) }
        switch method {
        case "screenWatchStart":
            return ScreenWatchDecoder.decodeStart(params).map { .success(.screenWatchStart($0)) }
                ?? .failure(.invalidParameters)
        case "screenWatchStop": return .success(.screenWatchStop)
        case "captureScreen": return decodeCapture(params, requestId: requestId)
        case "pinOnTop":
            guard let pinned = params["pinned"] as? Bool else { return .failure(.invalidParameters) }
            return .success(.pinOnTop(pinned))
        case "openExternal":
            guard let text = params["url"] as? String, let url = externalURL(text) else {
                return .failure(.invalidParameters)
            }
            return .success(.openExternal(url))
        case "presentation": return decodePresentation(params)
        default: return .failure(.unknownMethod)
        }
    }

    // [GUARD] Each operation takes exactly its own parameters, every value from a
    // closed set or a Bool; anything else is invalid.
    private static func decodePresentation(_ params: [String: Any]) -> Result<HostCall, HostCallError> {
        guard let op = params["op"] as? String else { return .failure(.invalidParameters) }
        let needs: [String: Set<String>] = [
            "openSettings": [], "closeSettings": [], "setVisible": ["visible"], "setInteractionMode": ["on"],
            "setAppMode": ["mode"], "setHotkeysEnabled": ["enabled"], "quit": [],
        ]
        // The window size takes a width and, optionally, a height.
        if op == "setWindowSize" {
            guard Set(params.keys).subtracting(["op", "height"]) == ["width"],
                let width = number(params["width"]), width.isFinite, width >= 200, width <= 4000
            else { return .failure(.invalidParameters) }
            var height: Double?
            if params["height"] != nil {
                guard let value = number(params["height"]), value.isFinite, value >= 60, value <= 4000 else {
                    return .failure(.invalidParameters)
                }
                height = value
            }
            return .success(.presentation(.setWindowSize(width: width, height: height)))
        }
        guard let required = needs[op], Set(params.keys).subtracting(["op"]) == required else {
            return .failure(.invalidParameters)
        }
        func bool(_ key: String) -> Bool? { params[key] as? Bool }
        let command: PresentationCommand?
        switch op {
        case "openSettings": command = .openSettings
        case "closeSettings": command = .closeSettings
        case "setVisible": command = bool("visible").map(PresentationCommand.setVisible)
        case "setInteractionMode": command = bool("on").map(PresentationCommand.setInteractionMode)
        case "setAppMode": command = (params["mode"] as? String).flatMap(AppMode.init(rawValue:)).map(PresentationCommand.setAppMode)
        case "quit": command = .quitApp
        default: command = bool("enabled").map(PresentationCommand.setHotkeysEnabled)
        }
        guard let command else { return .failure(.invalidParameters) }
        return .success(.presentation(command))
    }

    private static func decodeCapture(_ params: [String: Any], requestId: String) -> Result<HostCall, HostCallError> {
        guard let modeText = params["mode"] as? String, let mode = CaptureMode(rawValue: modeText) else {
            return .failure(.invalidParameters)
        }
        let rawRegion = params["region"]
        var displayId: UInt32?
        if let raw = params["displayId"], !(raw is NSNull) {
            // Only a region is bound to a display; the id is a plain unsigned 32-bit integer.
            guard mode == .region, let value = number(raw), value >= 0, value <= Double(UInt32.max),
                value == value.rounded()
            else { return .failure(.invalidParameters) }
            displayId = UInt32(value)
        }
        guard mode == .region else {
            return rawRegion == nil || rawRegion is NSNull
                ? .success(.captureScreen(CaptureRequest(requestId: requestId, mode: mode, expiresAt: Self.pageRequestExpiry), displayId: nil))
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
            region: CaptureRegion(x: x, y: y, width: width, height: height),
            expiresAt: Self.pageRequestExpiry), displayId: displayId))
    }

    // A page-initiated capture is not a companion request: the bridge bounds it by its own
    // single-flight ticket and timeout, so the wire expiry is a fixed far-future placeholder.
    public static let pageRequestExpiry = "9999-12-31T23:59:59.000Z"

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
    // Whether a presentation command took effect; a refusal is `false`, never a throw.
    @MainActor
    public static func tookEffect(_ command: PresentationCommand, _ state: PresentationState) -> Bool {
        switch command {
        case .openSettings: state.settingsOpen
        case .closeSettings: !state.settingsOpen
        case .setVisible(let visible): state.hidden != visible
        case .setInteractionMode(let on): state.interaction.isInteractive == on
        case .setAppMode(let mode): state.appMode == mode
        case .setHotkeysEnabled(let on): state.hotkeysEnabled == on
        default: true
        }
    }

    // `displayId` names the display the pixels came from, so a page can carry it
    // back with a later region request and the shell can refuse a changed display.
    public static func capture(
        _ outcome: CaptureOutcome, screenAccessGranted: Bool, displayId: UInt32? = nil
    ) -> [String: Any] {
        switch outcome {
        case .image(let jpeg, _):
            // The application name stays here: the page labels a frame by kind only.
            var reply: [String: Any] = ["ok": true, "mediaType": "image/jpeg", "base64": jpeg.base64EncodedString()]
            if let displayId { reply["displayId"] = Int(displayId) }
            return reply
        case .lost(let loss):
            if !screenAccessGranted { return failure("permission-denied") }
            return failure(loss == .noFocusedWindow ? "no-focused-window" : "capture-failed")
        }
    }

    public static func failure(_ reason: String) -> [String: Any] { ["ok": false, "reason": reason] }
    public static func screenWatchStarted(_ failure: ScreenWatchFailure?) -> [String: Any] {
        failure.map { Self.failure($0.rawValue) } ?? ["ok": true]
    }
}

// The script a WKUserScript injects into the main frame at document start. It
// defines a frozen `window.studioHost` that forwards each call to the native
// handler (a promise-returning `webkit.messageHandlers.studioHost`) and an event
// entry the shell calls for a hotkey. Page scripts can read it and call it; they
// cannot reach anything the shell has not decoded and bounded above.
public enum HostBridgeScript {
    public static func source(
        capabilities: [HostCapability], engineObject: String? = nil, engineEmit: String? = nil
    ) -> String {
        // The engine's page object and emit entry come from its own module
        // (Core cannot import it); they are spliced in only when supplied.
        let engineMember = engineObject.map { "engine: \($0),\n            " } ?? ""
        let engineDefinition = engineEmit ?? ""
        let names = capabilities.map { "\"\($0.rawValue)\"" }.joined(separator: ",")
        return """
        (function () {
          if (window.studioHost) return;
          var handler = window.webkit && window.webkit.messageHandlers
            && window.webkit.messageHandlers.\(HostBridge.handlerName);
          if (!handler) return;
          var listeners = [];
          var modeListeners = [];
          var engineListeners = [];
          var watchListeners = [];
          var watchStatusListeners = [];
          // Synchronous status() reads the last state the shell pushed.
          var watching = { watching: false };
          function remover(list, listener) {
            if (typeof listener !== "function") return function () {};
            list.push(listener);
            return function () {
              var at = list.indexOf(listener);
              if (at >= 0) list.splice(at, 1);
            };
          }
          var screenWatch = Object.freeze({
            start: function (request) {
              var r = request || {};
              var params = { mode: String(r.mode) };
              if (r.region !== undefined) params.region = r.region;
              if (r.displayId !== undefined) params.displayId = r.displayId;
              if (r.intervalMs !== undefined) params.intervalMs = Number(r.intervalMs);
              return call("screenWatchStart", params).then(
                function (reply) { return reply; },
                function () { return { ok: false, reason: "invalid" }; });
            },
            stop: function () { return call("screenWatchStop").then(function () {}); },
            status: function () { return { watching: watching.watching, reason: watching.reason }; },
            onChange: function (listener) { return remover(watchListeners, listener); },
            // Beyond the contract: why a watch ended (permission loss, a moved display).
            onStatus: function (listener) { return remover(watchStatusListeners, listener); }
          });
          // Synchronous reads come from the last state the shell pushed.
          var shown = { mode: "expanded", interactive: true, handsFree: false };
          function op(name, params) {
            var message = { op: name };
            Object.keys(params || {}).forEach(function (key) { message[key] = params[key]; });
            return call("presentation", message).then(function (took) { return took === true; });
          }
          var presentation = Object.freeze({
            capabilities: Object.freeze([\(PresentationCapability.allCases.map { "\"\($0.rawValue)\"" }.joined(separator: ","))]),
            nativeToasts: true,
            quit: function () { return op("quit"); },
            openSettings: function () { return op("openSettings"); },
            closeSettings: function () { return op("closeSettings"); },
            setVisible: function (visible) { return op("setVisible", { visible: !!visible }); },
            interactionMode: function () { return shown.interactive; },
            setInteractionMode: function (on) { return op("setInteractionMode", { on: !!on }); },
            onInteractionMode: function (listener) {
              if (typeof listener !== "function") return function () {};
              modeListeners.push(listener);
              return function () { modeListeners = modeListeners.filter(function (each) { return each !== listener; }); };
            },
            // The app's expanded/minified form, and the global keys.
            appMode: function () { return shown.mode; },
            setAppMode: function (mode) { return op("setAppMode", { mode: String(mode) }); },
            setHotkeysEnabled: function (enabled) { return op("setHotkeysEnabled", { enabled: !!enabled }); },
            setWindowSize: function (size) {
              var params = { width: Number(size && size.width) };
              if (size && size.height !== undefined) params.height = Number(size.height);
              return op("setWindowSize", params);
            }
          });
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
            \(engineMember)presentation: presentation,
            screenWatch: screenWatch,
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
          \(engineDefinition)
          Object.defineProperty(window, "__studioHostScreenWatchChange", {
            value: function (event) {
              var e = { at: Number(event.at), bits: Number(event.bits) };
              watchListeners.slice().forEach(function (listener) { try { listener(e); } catch (x) {} });
            },
            configurable: false
          });
          Object.defineProperty(window, "__studioHostScreenWatchStatus", {
            value: function (state) {
              watching = { watching: !!state.watching };
              if (typeof state.reason === "string") watching.reason = state.reason;
              var copy = { watching: watching.watching, reason: watching.reason };
              watchStatusListeners.slice().forEach(function (listener) { try { listener(copy); } catch (x) {} });
            },
            configurable: false
          });
          Object.defineProperty(window, "__studioHostPresentation", {
            value: function (state) {
              var before = shown.interactive;
              shown = { mode: String(state.mode), interactive: !!state.interactive, handsFree: !!state.handsFree };
              if (before !== shown.interactive) {
                modeListeners.slice().forEach(function (listener) { try { listener(shown.interactive); } catch (e) {} });
              }
            },
            configurable: false
          });
        })();
        """
    }

    // The call the shell evaluates in the page for a hotkey.
    public static func emit(_ command: HostCommand) -> String {
        "window.__studioHostEmit && window.__studioHostEmit(\"\(command.wireName)\");"
    }

    // One settled change in the watched screen: only a time and a bit count.
    public static func emitScreenWatchChange(at: Int, bits: Int) -> String {
        "window.__studioHostScreenWatchChange && window.__studioHostScreenWatchChange({at:\(at),bits:\(bits)});"
    }

    public static func emitScreenWatchStatus(_ status: ScreenWatchStatus) -> String {
        let json = (try? JSONSerialization.data(withJSONObject: status.wire, options: [.sortedKeys]))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return "window.__studioHostScreenWatchStatus && window.__studioHostScreenWatchStatus(\(json));"
    }

    // Pushes the presentation state to a page: it reads it synchronously and
    // hears an interaction-mode change as `onInteractionMode`.
    public static func emitPresentation(_ state: PresentationState) -> String {
        let json = (try? JSONSerialization.data(withJSONObject: state.wire, options: [.sortedKeys]))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return "window.__studioHostPresentation && window.__studioHostPresentation(\(json));"
    }
}
