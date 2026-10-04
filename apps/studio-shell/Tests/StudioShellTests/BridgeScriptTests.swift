import Foundation
import JavaScriptCore
import StudioShellCore

// Runs the injected script in JavaScriptCore against a fake WebKit handler, so
// the contract the page sees (version, kind, capabilities, calls, hotkeys) is
// what is tested, not a copy of it.
private func page(capabilities: [HostCapability], withHandler: Bool = true) -> JSContext {
    let context = JSContext()!
    context.exceptionHandler = { _, value in print("js exception: \(value?.toString() ?? "?")") }
    context.evaluateScript("var window = this; var __posted = [];")
    if withHandler {
        context.evaluateScript("""
        window.webkit = { messageHandlers: { studioHost: {
          postMessage: function (m) { __posted.push(JSON.stringify(m)); return Promise.resolve({ ok: true }); } } } };
        """)
    }
    context.evaluateScript(HostBridgeScript.source(capabilities: capabilities))
    return context
}

@MainActor
func bridgeScriptTests(_ t: Harness) async {
    await t.test("capability negotiation: version, kind and the capabilities the shell offers") {
        let context = page(capabilities: HostCapability.allCases)
        t.expectEqual(context.evaluateScript("window.studioHost.version")?.toInt32(), 1)
        t.expectEqual(context.evaluateScript("window.studioHost.hostKind")?.toString(), "native-macos")
        t.expectEqual(context.evaluateScript("window.studioHost.capabilities.join(',')")?.toString(),
            "capture-screen,pin-on-top,hotkeys,open-external,engine")
        let narrowed = page(capabilities: [.captureScreen])
        t.expectEqual(narrowed.evaluateScript("window.studioHost.capabilities.join(',')")?.toString(), "capture-screen")
        // The names are the TypeScript contract's: keep the two in step.
        t.expectEqual(HostCapability.allCases.map(\.rawValue), ["capture-screen", "pin-on-top", "hotkeys", "open-external", "engine"])
        t.expectEqual(HostBridge.version, 1)
    }

    await t.test("each call becomes one versioned message, and the bridge cannot be replaced") {
        let context = page(capabilities: HostCapability.allCases)
        context.evaluateScript("""
        window.studioHost.captureScreen({ mode: 'region', region: { x: 0, y: 0, width: 0.5, height: 0.5 } });
        window.studioHost.pinOnTop(true);
        window.studioHost.openExternal('https://example.com');
        """)
        t.expectEqual(context.evaluateScript("__posted.length")?.toInt32(), 3)
        t.expectEqual(context.evaluateScript("__posted[0]")?.toString(),
            #"{"v":1,"method":"captureScreen","params":{"mode":"region","region":{"x":0,"y":0,"width":0.5,"height":0.5}}}"#)
        t.expectEqual(context.evaluateScript("__posted[1]")?.toString(), #"{"v":1,"method":"pinOnTop","params":{"pinned":true}}"#)
        context.evaluateScript("try { window.studioHost = {}; } catch (e) {}")
        t.expectEqual(context.evaluateScript("window.studioHost.version")?.toInt32(), 1)
        context.evaluateScript("try { window.studioHost.version = 9; } catch (e) {}")
        t.expectEqual(context.evaluateScript("window.studioHost.version")?.toInt32(), 1)
    }

    await t.test("a hotkey reaches the page's listeners until they are removed") {
        let context = page(capabilities: HostCapability.allCases)
        context.evaluateScript("""
        var seen = [];
        var off = window.studioHost.onHotkey(function (name) { seen.push(name); });
        """)
        context.evaluateScript(HostBridgeScript.emit(.captureAnalyze))
        t.expectEqual(context.evaluateScript("seen.join(',')")?.toString(), "capture.analyze")
        context.evaluateScript("off();")
        context.evaluateScript(HostBridgeScript.emit(.captureAnalyze))
        t.expectEqual(context.evaluateScript("seen.length")?.toInt32(), 1)
    }

    await t.test("without the native handler no bridge is defined (a browser is unaffected)") {
        let context = page(capabilities: HostCapability.allCases, withHandler: false)
        t.expect(context.evaluateScript("typeof window.studioHost")?.toString() == "undefined", "no studioHost")
    }
}
