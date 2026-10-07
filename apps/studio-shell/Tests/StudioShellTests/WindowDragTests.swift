import StudioShellCore

@MainActor
func windowDragTests(_ t: Harness) async {
    await t.test("window drag: starts only after the pointer travels past the threshold") {
        t.expect(!WindowDrag.exceedsThreshold(dx: 2, dy: 2), "a click is not a drag")
        t.expect(WindowDrag.exceedsThreshold(dx: 5, dy: 0), "five points is a drag")
    }
    await t.test(
        "window drag: the probe leaves controls, text fields and code to the page, and the toolbar and footer always drag"
    ) {
        let script = WindowDrag.probeScript(x: 10.5, y: 20)
        t.expect(script.contains("elementFromPoint(10.5, 20.0)"), "asks about the pressed point")
        for control in [
            "button", "textarea", "[contenteditable]", "pre", ".cm-editor", "[data-no-drag]",
        ] {
            t.expect(script.contains(control), "\(control) keeps its own gesture")
        }
        for kind in ["'pointer'", "'text'", "'grab'", "'arrow'"] {
            t.expect(script.contains("return \(kind)"), "answers \(kind)")
        }
        t.expect(script.contains("data-hit-surfaces"), "only a drawn surface drags, never transparent glass")
        t.expect(script.contains("data-drag-chrome"), "the page says what always drags")
        t.expect(script.contains("data-text-surfaces"), "the page says what is text to read and copy")
        t.expect(
            script.contains("getAttribute('data-text-surfaces') || '"),
            "an older page falls back to the built-in text list")
        t.expect(script.contains(WindowDrag.chromeFallback), "an older page still drags by its toolbar and footer")
        t.expect(script.contains(WindowDrag.typingFallback), "an older page keeps its text surfaces")
        for stale in [".pn-log", ".pn-interim", ".pn-analysis-text", ".pn-codecard"] {
            t.expect(!script.contains(stale), "\(stale) is gone from the page and from the probe")
        }
        t.expect(script.contains("[data-glass=\"clear\"]"), "see-through glass keeps the card for reading")
    }
}
