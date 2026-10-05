import AppKit
import StudioShellCore

// [DOMAIN] The AppKit half of See-through click-through. While the page has
// reported hit regions, this follows the pointer and sets the window's
// `ignoresMouseEvents` to what Core's pure decision says (HitTest): the window
// takes the mouse over a reported surface and passes it to the app underneath
// everywhere else. It owns no rule of its own.
//
// [SAFETY] The window must never stay inert by accident, so it is interactive
// again whenever: the page reports `null`, the reports go stale (HitRegions.staleAfter,
// a reload or a hung page), the window hides, or the app terminates. It does NOT
// reset when the app deactivates: passing a click to Chrome deactivates this app,
// and resetting then would undo the pass-through on every click.
//
// Pointer tracking uses NSEvent global and local monitors for mouse-moved,
// left-dragged and left-up events. By Apple's documentation, only KEY-related
// events need Accessibility trust for a global monitor; mouse events do not, so
// this asks for no permission. (Not exercised in this environment: the first live
// run is the check.) A global monitor never sees events delivered to this app's own
// windows, so a local monitor covers those; the window accepts mouse-moved events
// for as long as regions are active so the local one receives them.
//
// While Studio is inactive and the panel is not key, AppKit delivers a pointer move that
// stays inside this window to Studio only if something asks for it; neither monitor is
// guaranteed to see it. So while regions are active the panel's content view also carries
// an `.activeAlways` NSTrackingArea that reports every move over the window, whatever the
// active app: a move from a reported region into a transparent area then flips
// `ignoresMouseEvents` before the click. STILL TO VERIFY LIVE: that a click right after
// such a move reaches the browser, with Studio inactive and the panel not key.
@MainActor
final class HitRegionTracker: NSObject {
    private let panel: NSPanel
    private let topInset: Double
    private let apply: (Bool) -> Void
    private var lease = HitRegionLease()
    private var global: Any?
    private var local: Any?
    private var staleWork: DispatchWorkItem?
    // A tracker is created by the first report, which can arrive while the window is hidden:
    // it then starts suspended (no monitors, interactive) until a show resumes it.
    private var suspended: Bool
    private var trackingArea: NSTrackingArea?

    private static let events: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged, .leftMouseUp]
    private static func now() -> TimeInterval { ProcessInfo.processInfo.systemUptime }

    // `apply(true)` means the window should ignore the mouse now.
    init(panel: NSPanel, topInset: Double, apply: @escaping (Bool) -> Void) {
        self.panel = panel
        self.topInset = topInset
        self.apply = apply
        suspended = !panel.isVisible
        super.init()
    }

    // The tracking area's owner: every move over the window re-evaluates the decision.
    @objc func mouseMoved(with event: NSEvent) { pointerMoved() }

    // A report from the page: a list masks the window, nil takes the mask off.
    func set(_ regions: [HitRect]?) {
        lease.update(regions, now: Self.now())
        guard regions != nil else { return release() }
        scheduleStaleCheck()
        if !suspended {
            installMonitors()
            evaluate()
        }
    }

    // The window hid: interactive again and no monitors, but the report is kept so a
    // show picks it up (it goes stale on its own if the page stays silent).
    func suspend() {
        suspended = true
        removeMonitors()
        staleWork?.cancel()
        apply(false)
    }

    func resume() {
        suspended = false
        guard lease.current(now: Self.now()) != nil else { return }
        scheduleStaleCheck()
        installMonitors()
        evaluate()
    }

    // Everything off: interactive, no monitors, no report.
    func release() {
        lease = HitRegionLease()
        staleWork?.cancel()
        removeMonitors()
        apply(false)
    }

    private func evaluate() {
        let now = Self.now()
        guard lease.current(now: now) != nil else {
            // Stale (or never reported): back to interactive, quietly.
            removeMonitors()
            apply(false)
            return
        }
        guard panel.isVisible else { return apply(false) }
        let geometry = HitGeometry(windowFrame: panel.frame, topInset: topInset)
        apply(lease.ignoresMouse(at: NSEvent.mouseLocation, in: geometry, now: now))
    }

    // One check when the report would go stale, so a stationary pointer over a
    // transparent area is freed even without a mouse move.
    private func scheduleStaleCheck() {
        staleWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated { self?.evaluate() }
        }
        staleWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + HitRegions.staleAfter + 0.25, execute: work)
    }

    private func installMonitors() {
        panel.acceptsMouseMovedEvents = true
        if trackingArea == nil, let content = panel.contentView {
            let area = NSTrackingArea(
                rect: .zero, options: [.mouseMoved, .activeAlways, .inVisibleRect], owner: self, userInfo: nil)
            content.addTrackingArea(area)
            trackingArea = area
        }
        guard global == nil else { return }
        // [GUARD] While a button is down (a drag in progress) the decision is left alone:
        // flipping it mid-drag would send the release to a different app.
        global = NSEvent.addGlobalMonitorForEvents(matching: Self.events) { [weak self] _ in
            MainActor.assumeIsolated { self?.pointerMoved() }
        }
        local = NSEvent.addLocalMonitorForEvents(matching: Self.events) { [weak self] event in
            MainActor.assumeIsolated { self?.pointerMoved() }
            return event
        }
    }

    private func removeMonitors() {
        if let global { NSEvent.removeMonitor(global) }
        if let local { NSEvent.removeMonitor(local) }
        global = nil
        local = nil
        if let trackingArea { panel.contentView?.removeTrackingArea(trackingArea) }
        trackingArea = nil
        panel.acceptsMouseMovedEvents = false
    }

    private func pointerMoved() {
        guard NSEvent.pressedMouseButtons == 0 else { return }
        evaluate()
    }
}
