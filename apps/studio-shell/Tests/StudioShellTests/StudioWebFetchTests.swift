import Foundation
import JavaScriptCore
import StudioShellEngine

// The one in-web-view fetch (StudioWebFetch). The private content world itself
// is WebKit's and not testable here; the script it runs and the way its answer is
// read are, in JavaScriptCore against a fake `fetch`.
private func run(method: String, body: String?, ok: Bool = true) -> [String: Any]? {
    let context = JSContext()!
    context.exceptionHandler = { _, value in print("js exception: \(value?.toString() ?? "?")") }
    context.evaluateScript(
        """
        var seen = null, out = null;
        function fetch(path, init) {
          seen = { path: path, init: init };
          return Promise.resolve({ status: \(ok ? 200 : 403), ok: \(ok), text: function () { return Promise.resolve("{}"); } });
        }
        (async function (path, method, body) { \(StudioWebFetch.script) })("/p", \(method.debugDescription), \(body.map { $0.debugDescription } ?? "null"))
          .then(function (r) { out = r; });
        """)
    guard let answer = context.evaluateScript("JSON.stringify({ seen: seen, out: out })")?.toString(),
        let data = answer.data(using: .utf8)
    else { return nil }
    return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
}

@MainActor
func studioWebFetchTests(_ t: Harness) async {
    await t.test("the shared fetch sends same-origin credentials and a JSON type only when there is something to say") {
        let get = run(method: "GET", body: nil)
        let getInit = (get?["seen"] as? [String: Any])?["init"] as? [String: Any]
        t.expectEqual(getInit?["credentials"] as? String, "same-origin")
        t.expectEqual((getInit?["headers"] as? [String: Any])?.count, 0, "a GET carries no content type")
        let post = run(method: "POST", body: #"{"pause":true}"#)
        let postInit = (post?["seen"] as? [String: Any])?["init"] as? [String: Any]
        t.expectEqual(postInit?["body"] as? String, #"{"pause":true}"#)
        t.expectEqual((postInit?["headers"] as? [String: String])?["content-type"], "application/json")
        let credential = run(method: "POST", body: nil)
        let credentialInit = (credential?["seen"] as? [String: Any])?["init"] as? [String: Any]
        t.expectEqual(
            (credentialInit?["headers"] as? [String: String])?["content-type"], "application/json",
            "a body-less POST keeps its type")
        let delete = run(method: "DELETE", body: nil)
        t.expectEqual(
            (((delete?["seen"] as? [String: Any])?["init"] as? [String: Any])?["headers"] as? [String: Any])?.count, 0)
    }

    await t.test("an answer is a status and, only for an ok response, its text") {
        let ok = run(method: "GET", body: nil)?["out"]
        t.expectEqual(StudioWebFetch.answer(from: ok), StudioAnswer(status: 200, text: "{}"))
        let refused = run(method: "GET", body: nil, ok: false)?["out"]
        t.expectEqual(StudioWebFetch.answer(from: refused), StudioAnswer(status: 403, text: nil))
        t.expectEqual(StudioWebFetch.answer(from: nil), nil)
        t.expectEqual(StudioWebFetch.answer(from: ["status": "200"]), nil, "a forged shape is not an answer")
    }
}
