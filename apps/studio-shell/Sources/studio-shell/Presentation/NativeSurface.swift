import AppKit
import StudioShellCore
import WebKit

// [DOMAIN] The macOS adapter for the Core's presentation interface. It owns no
// decision: `PresentationController` (Core) turns a typed command into a
// `PresentationState`, and this surface renders that state with NSPanel and
// NSWindow and persists window frames. Menu items, hotkeys and the page's
// `window.studioHost.presentation` calls all reach it through the controller.
//
// [SAFETY] No concealment: `sharingType` is never set anywhere here, so every
// window keeps the default and shows in screen shares (ADR-0019).

// Where a window's page loads from; nil until Studio is configured.
enum SurfaceTarget: Hashable {
    case main
    case compact
    case panel(PanelKind)
}

@MainActor
final class NativeSurface: NSObject, PresentationSurface, NSWindowDelegate {
    private let model: ShellModel
    private let makeWebView: () -> WKWebView
    private let urlFor: (SurfaceTarget) -> URL?
    private let toasts = ToastPresenter()
    private var panels: [PanelKind: PanelWindow] = [:]
    private var compact: PanelWindow?
    private var main: NSWindow?
    private var mainView: WKWebView?
    private var pinned = true
    private var observers: [NSObjectProtocol] = []
    // Called after every render (the hotkey set, the menu and the pages follow the state).
    var onRender: (PresentationState) -> Void = { _ in }
    // Asked to mode-switch when the person closes the main window.
    var requestMode: (AppMode) -> Void = { _ in }

    init(model: ShellModel, makeWebView: @escaping () -> WKWebView, urlFor: @escaping (SurfaceTarget) -> URL?) {
        self.model = model
        self.makeWebView = makeWebView
        self.urlFor = urlFor
        super.init()
        // [SAFETY] Panels must stay over any app, Space and full-screen window:
        // re-assert level and ordering whenever the active Space or app changes.
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.activeSpaceDidChangeNotification, NSWorkspace.didActivateApplicationNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.reassert() }
            })
        }
    }

    // MARK: render

    func render(_ state: PresentationState) {
        for kind in PanelKind.allCases {
            if state.shownPanels.contains(kind) {
                let window = panelWindow(kind)
                window.setInteractive(state.interaction.isInteractive)
                window.setOpacity(state.opacity)
                window.show(pinned: pinned)
            } else {
                panels[kind]?.hide()
            }
        }
        if state.compactShown {
            let window = compactWindow()
            window.setInteractive(true)
            window.setOpacity(state.opacity)
            window.show(pinned: pinned)
        } else {
            compact?.hide()
        }
        if state.mainWindowShown { showMain() } else { main?.orderOut(nil) }
        onRender(state)
    }

    func focus(_ panel: PanelKind) {
        // Non-activating: the panel can take keys without taking the app's focus.
        panels[panel]?.panel.orderFrontRegardless()
        if model.prefs.interaction.isInteractive { panels[panel]?.panel.makeKey() }
    }

    func bringToFront() { reassert() }

    func reassert() {
        for window in panels.values where window.panel.isVisible { window.show(pinned: pinned) }
        if let compact, compact.panel.isVisible { compact.show(pinned: pinned) }
    }

    func setPinned(_ value: Bool) {
        pinned = value
        reassert()
    }

    func toast(_ toast: Toast) {
        // Bottom-left of the main display (the one the pill is on).
        let screen = panels[.pill]?.panel.screen ?? NSScreen.main
        toasts.show(toast, on: screen?.frame ?? CGRect(x: 0, y: 0, width: 1440, height: 900))
    }

    func quit() { NSApp.terminate(nil) }

    // MARK: placement

    private var displays: [CGRect] { NSScreen.screens.map(\.visibleFrame) }
    private var mainArea: CGRect { NSScreen.main?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1440, height: 900) }

    func resetFrames() {
        model.prefs.resetLayout()
        for (kind, window) in panels { window.setFrame(PanelLayout.defaultFrame(kind, in: mainArea)) }
        if let main { main.setFrame(model.prefs.mainWindowFrame(displays: displays, main: mainArea), display: true) }
    }

    func movePanels(dx: Double, dy: Double) {
        for (kind, window) in panels where window.panel.isVisible {
            let area = window.panel.screen?.visibleFrame ?? mainArea
            window.setFrame(PanelLayout.nudge(window.panel.frame, dx: dx, dy: dy, in: area, min: kind.minSize))
        }
    }

    func resizePanel(_ kind: PanelKind, dw: Double, dh: Double) {
        guard kind.isResizable, let window = panels[kind], window.panel.isVisible else { return }
        let area = window.panel.screen?.visibleFrame ?? mainArea
        window.setFrame(PanelLayout.resize(window.panel.frame, dw: dw, dh: dh, in: area, min: kind.minSize))
    }

    // MARK: windows and pages

    func view(for kind: PanelKind) -> WKWebView? { panels[kind]?.webView }
    var compactView: WKWebView? { compact?.webView }
    func setCompactSize(width: Double, height: Double?) { compact?.setSize(width: CGFloat(width), height: height.map { CGFloat($0) }) }
    var mainWindowView: WKWebView? { mainView }
    var panelViews: [WKWebView] { PanelKind.allCases.compactMap { panels[$0]?.webView } }
    var mainWindow: NSWindow? { main }
    var anchorWindow: NSWindow? { main?.isVisible == true ? main : (panels[.pill]?.panel ?? compact?.panel) }

    // Loads every existing window from its current address (a session switch or a rebind).
    func reloadAll() {
        for (kind, window) in panels { load(window.webView, .panel(kind)) }
        if let compact { load(compact.webView, .compact) }
        if let mainView { load(mainView, .main) }
    }

    private func load(_ view: WKWebView, _ target: SurfaceTarget, onlyIfBlank: Bool = false) {
        guard let url = urlFor(target) else { return }
        if onlyIfBlank, view.url != nil || view.isLoading { return }
        view.load(URLRequest(url: url))
    }

    private func panelWindow(_ kind: PanelKind) -> PanelWindow {
        if let existing = panels[kind] { return existing }
        let frame = model.prefs.frame(kind, displays: displays, main: mainArea)
        let window = PanelWindow(kind: kind, webView: makeWebView(), frame: frame) { [weak self] frame in
            self?.model.prefs.saveFrame(kind, frame)
        }
        wireControls(window)
        panels[kind] = window
        load(window.webView, .panel(kind), onlyIfBlank: true)
        return window
    }

    private func compactWindow() -> PanelWindow {
        if let compact { return compact }
        let area = mainArea
        let saved = PanelFrameCodec.restoreFrame(
            UserDefaults.standard.string(forKey: "shell.compact.frame"), minSize: CGSize(width: 320, height: 360),
            fixedSize: nil, displays: displays)
        let frame = saved ?? CGRect(x: area.maxX - 460, y: area.minY + 24, width: 440, height: 640)
        let window = PanelWindow(kind: nil, webView: makeWebView(), frame: frame) { frame in
            UserDefaults.standard.set(PanelFrameCodec.encode(frame), forKey: "shell.compact.frame")
        }
        wireControls(window)
        compact = window
        load(window.webView, .compact, onlyIfBlank: true)
        return window
    }

    // The strip's buttons: close quits the app; expand opens the main Studio window.
    private func wireControls(_ window: PanelWindow) {
        window.onClose = { NSApp.terminate(nil) }
        // Green maximizes to the full Studio view. The analysis is revealed by the
        // toolbar (a wider window), never by a handle of its own.
        window.onExpand = { [weak self] in self?.requestMode(.expanded) }
    }

    private func showMain() {
        if main == nil {
            let view = makeWebView()
            view.setValue(true, forKey: "drawsBackground")
            let window = NSWindow(
                contentRect: model.prefs.mainWindowFrame(displays: displays, main: mainArea),
                styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "Interview Studio · \(VisibilityTruth.line)"
            window.isReleasedWhenClosed = false
            window.minSize = ShellPrefs.mainWindowMinSize
            window.contentView = view
            window.delegate = self
            main = window
            mainView = view
            load(view, .main)
        } else if let mainView {
            load(mainView, .main, onlyIfBlank: true)
        }
        // The main window is an ordinary window: showing it activates the app.
        NSApp.activate(ignoringOtherApps: true)
        main?.makeKeyAndOrderFront(nil)
    }

    // The red button minifies; it does not quit.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === main { requestMode(.minified); return false }
        return true
    }

    func windowDidMove(_ notification: Notification) { saveMain(notification) }
    func windowDidEndLiveResize(_ notification: Notification) { saveMain(notification) }
    private func saveMain(_ notification: Notification) {
        if let window = notification.object as? NSWindow, window === main { model.prefs.saveMainWindowFrame(window.frame) }
    }
}

// One floating panel (or the compact window when `kind` is nil): borderless,
// non-activating, translucent, rounded, draggable by its header strip.
@MainActor
final class PanelWindow: NSObject, NSWindowDelegate {
    let kind: PanelKind?
    let panel: StudioPanel
    let webView: WKWebView
    private let onFrame: (CGRect) -> Void
    private var effect: NSVisualEffectView?
    /// What the strip's buttons ask for: quit the app, or open the main window.
    var onClose: (() -> Void)?
    var onExpand: (() -> Void)?

    init(kind: PanelKind?, webView: WKWebView, frame: CGRect, onFrame: @escaping (CGRect) -> Void) {
        self.kind = kind
        self.webView = webView
        self.onFrame = onFrame
        // [DOMAIN] A titled window with its title bar hidden and the content drawn
        // under it: macOS gives edge-resize, dragging and a proper key window to a
        // titled window, but not to a .borderless one (which could not be resized
        // or reliably selected). It still looks chromeless: the bar is transparent,
        // the title and buttons are hidden and the content fills the frame.
        panel = StudioPanel(
            contentRect: frame,
            styleMask: [.titled, .fullSizeContentView, .resizable, .nonactivatingPanel],
            backing: .buffered, defer: false)
        super.init()
        panel.titlebarAppearsTransparent = true
        panel.titleVisibility = .hidden
        // The video's panels have no chrome: no traffic lights, no title strip. Only
        // the compact window (kind nil) keeps its lights (red quits, green expands).
        let showControls = kind == nil
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        if let close = panel.standardWindowButton(.closeButton) {
            close.isHidden = !showControls
            close.target = self
            close.action = #selector(closeTapped)
        }
        if let zoom = panel.standardWindowButton(.zoomButton) {
            zoom.isHidden = !showControls
            zoom.target = self
            zoom.action = #selector(zoomTapped)
        }
        panel.isMovableByWindowBackground = true
        panel.setFrame(frame, display: false)
        panel.delegate = self
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.minSize = kind?.minSize ?? CGSize(width: 320, height: 360)
        if kind?.isResizable == false { panel.maxSize = kind!.defaultSize }
        webView.setValue(false, forKey: "drawsBackground")
        webView.underPageBackgroundColor = .clear

        let effect = NSVisualEffectView(frame: CGRect(origin: .zero, size: frame.size))
        effect.material = .hudWindow
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.wantsLayer = true
        // The bar drags by its left grip (the page sits beside it). A panel's page
        // fills the whole frame and a transparent 22 pt strip over its top edge
        // drags the window (the page insets its content). The compact window keeps
        // its visible grip strip.
        let vertical = kind == .pill
        let compactWindow = kind == nil
        let strip: CGFloat = vertical ? 14 : (compactWindow ? 16 : 22)
        let size = frame.size
        let handle = DragHandle(frame: vertical
            ? CGRect(x: 0, y: 0, width: strip, height: size.height)
            : CGRect(x: 0, y: size.height - strip, width: size.width, height: strip))
        handle.autoresizingMask = vertical ? [.height] : [.width, .minYMargin]
        handle.vertical = vertical
        handle.showsGrip = vertical || compactWindow
        let insetPage = vertical || compactWindow
        webView.frame = vertical
            ? CGRect(x: strip, y: 0, width: size.width - strip, height: size.height)
            : CGRect(x: 0, y: 0, width: size.width, height: size.height - (insetPage ? strip : 0))
        webView.autoresizingMask = [.width, .height]
        // The blur is its own layer so its opacity can change without fading the
        // page's text; the page above it is transparent when hosted natively.
        effect.autoresizingMask = [.width, .height]
        self.effect = effect
        let container = NSView(frame: CGRect(origin: .zero, size: frame.size))
        container.wantsLayer = true
        container.layer?.cornerRadius = 14
        container.layer?.masksToBounds = true
        container.addSubview(effect)
        container.addSubview(webView)
        container.addSubview(handle)
        // The whole toolbar drags: the bar window entirely, and the top of the one
        // window (the strip plus the bar's row).
        if kind == .pill || compactWindow {
            let bar = ToolbarDragView(frame: kind == .pill
                ? CGRect(origin: .zero, size: size)
                : CGRect(x: 0, y: size.height - 62, width: size.width, height: 62))
            bar.autoresizingMask = kind == .pill ? [.width, .height] : [.width, .minYMargin]
            container.addSubview(bar)
        }
        // [DOMAIN] Real controls, because a chromeless window has no title bar to
        // close it by: close (quits the app), expand (the main Studio window), and
        // resize handles on every edge and corner (a borderless-looking window gets
        // no native edge-resize where the web view covers the frame).
        for edge in ResizeHandle.Edge.allCases {
            let handle = ResizeHandle(edge: edge, minSize: panel.minSize)
            handle.frame = edge.frame(in: size)
            handle.autoresizingMask = edge.autoresizing
            container.addSubview(handle)
        }
        container.layer?.backgroundColor = CGColor.clear
        container.layer?.isOpaque = false
        effect.layer?.backgroundColor = nil
        webView.wantsLayer = true
        webView.layer?.backgroundColor = CGColor.clear
        webView.layer?.isOpaque = false
        panel.contentView = container
        panel.contentView?.layer?.backgroundColor = CGColor.clear
        audit()
    }

    // [SAFETY] Reads the live hierarchy back into Core's snapshot and logs (no
    // content, only a layer description) anything that would make it opaque.
    private func audit() {
        func alpha(_ color: CGColor?) -> Double { color.map { Double($0.alpha) } ?? 0 }
        var others: [Double] = []
        if let content = panel.contentView {
            others.append(alpha(content.layer?.backgroundColor))
            for view in content.subviews where view !== effect && view !== webView {
                others.append(alpha(view.layer?.backgroundColor))
            }
            others.append(alpha(webView.layer?.backgroundColor))
            if content.layer?.isOpaque == true || webView.layer?.isOpaque == true { others.append(1) }
        }
        let snapshot = PanelChromeSnapshot(
            windowIsOpaque: panel.isOpaque, windowBackgroundAlpha: Double(panel.backgroundColor.alphaComponent),
            windowHasShadow: panel.hasShadow, webViewDrawsBackground: (webView.value(forKey: "drawsBackground") as? Bool) ?? true,
            webViewUnderPageAlpha: Double(webView.underPageBackgroundColor?.alphaComponent ?? 0),
            otherBackgroundAlphas: others, hasVisualEffect: effect != nil)
        let problems = PanelChrome.violations(snapshot)
        if !problems.isEmpty { NSLog("studio-shell: panel is not see-through: %@", problems.joined(separator: "; ")) }
    }

    @objc private func closeTapped() { onClose?() }
    @objc private func zoomTapped() { onExpand?() }

    // The height the window had before it was fitted to its content.
    private var tallHeight: CGFloat?

    // Take this size. Width changes are even about the window's centre so the
    // toolbar at the top does not move; a height fits the window to its content
    // from the top edge (remembering the old height), and none restores it. The
    // result stays inside the display.
    func setSize(width requested: CGFloat, height requestedHeight: CGFloat?) {
        var frame = panel.frame
        let visible = (panel.screen ?? NSScreen.main)?.visibleFrame
        let width = min(max(requested, panel.minSize.width), visible.map { $0.width - 16 } ?? requested)
        // Page points plus the native strip over the top of the page.
        let wantHeight: CGFloat
        if let requestedHeight {
            if frame.height > requestedHeight + 40 { tallHeight = frame.height }
            wantHeight = requestedHeight + 16
        } else {
            wantHeight = tallHeight ?? frame.height
            tallHeight = nil
        }
        let height = min(max(wantHeight, 60), visible.map { $0.height - 16 } ?? wantHeight)
        guard abs(width - frame.width) > 0.5 || abs(height - frame.height) > 0.5 else { return }
        let centre = frame.midX
        let top = frame.maxY
        frame.size = CGSize(width: width, height: height)
        frame.origin.x = centre - width / 2
        frame.origin.y = top - height
        if let visible {
            frame.origin.x = min(max(frame.origin.x, visible.minX + 8), visible.maxX - width - 8)
            frame.origin.y = min(max(frame.origin.y, visible.minY + 8), visible.maxY - height)
        }
        panel.setFrame(frame, display: true, animate: true)
    }

    func setInteractive(_ on: Bool) { panel.ignoresMouseEvents = !on }
    // The video's panels are a flat tint over a sharp page: the blur layer stays off.
    func setOpacity(_ value: Double) { effect?.alphaValue = 0 }

    // [SAFETY] Over any app, Space and full-screen window (PanelWindowTraits).
    func show(pinned: Bool) {
        let traits = PanelWindowTraits.of(kind ?? .analysis, pinned: pinned)
        panel.level = switch traits.level {
        case .normal: .normal
        case .floating: .floating
        case .statusBar: .statusBar
        }
        panel.hidesOnDeactivate = traits.hidesOnDeactivate
        panel.orderFrontRegardless()
    }

    func hide() { panel.orderOut(nil) }

    func setFrame(_ frame: CGRect) {
        panel.setFrame(frame, display: true)
        onFrame(frame)
    }

    func windowDidMove(_ notification: Notification) { onFrame(panel.frame) }
    func windowDidEndLiveResize(_ notification: Notification) { onFrame(panel.frame) }
}

// Over the toolbar: a drag moves the window; a plain click is handed on to the
// page underneath (its buttons still work).
final class ToolbarDragView: NSView {
    private var down: NSEvent?
    private var dragged = false
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { down = event; dragged = false }
    override func mouseDragged(with event: NSEvent) {
        guard let start = down, !dragged else { return }
        if hypot(event.locationInWindow.x - start.locationInWindow.x, event.locationInWindow.y - start.locationInWindow.y) > 3 {
            dragged = true
            window?.performDrag(with: start)
        }
    }
    override func mouseUp(with event: NSEvent) {
        defer { down = nil }
        guard !dragged, let start = down, let window else { return }
        // A click: let the page have it, then take the area back.
        isHidden = true
        window.sendEvent(start)
        window.sendEvent(event)
        DispatchQueue.main.async { [weak self] in self?.isHidden = false }
    }
}

final class DragHandle: NSView {
    var vertical = false
    var showsGrip = true
    override var mouseDownCanMoveWindow: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        guard showsGrip else { return }
        NSColor.secondaryLabelColor.withAlphaComponent(0.5).setFill()
        let grip = vertical
            ? CGRect(x: bounds.midX - 1.5, y: bounds.midY - 14, width: 3, height: 28)
            : CGRect(x: bounds.midX - 14, y: bounds.midY - 1.5, width: 28, height: 3)
        NSBezierPath(roundedRect: grip, xRadius: 1.5, yRadius: 1.5).fill()
    }
}

// The video's toast: large white text over a dark left-to-right gradient at the
// bottom-left of the display; click-through, ~3 s, fades, never takes focus.
@MainActor
final class ToastPresenter {
    private let panel: NSPanel
    private let gradient = CAGradientLayer()
    private let title = NSTextField(labelWithString: "")
    private let subtitle = NSTextField(labelWithString: "")
    private var hideWork: DispatchWorkItem?

    init() {
        panel = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        let content = NSView()
        content.wantsLayer = true
        gradient.colors = [NSColor.black.withAlphaComponent(0.78).cgColor, NSColor.black.withAlphaComponent(0).cgColor]
        gradient.startPoint = CGPoint(x: 0, y: 0.5)
        gradient.endPoint = CGPoint(x: 1, y: 0.5)
        content.layer?.addSublayer(gradient)
        title.font = .systemFont(ofSize: 30, weight: .medium)
        subtitle.font = .systemFont(ofSize: 19, weight: .regular)
        for label in [title, subtitle] {
            label.textColor = .white
            label.lineBreakMode = .byTruncatingTail
            content.addSubview(label)
        }
        panel.contentView = content
    }

    func show(_ toast: Toast, on screen: CGRect) {
        title.stringValue = toast.title
        subtitle.stringValue = toast.subtitle
        let frame = ToastLayout.frame(on: screen)
        panel.setFrame(frame, display: true)
        gradient.frame = CGRect(origin: .zero, size: frame.size)
        title.frame = CGRect(x: ToastLayout.padding, y: 44, width: frame.width - ToastLayout.padding * 2, height: 38)
        subtitle.frame = CGRect(x: ToastLayout.padding, y: 16, width: frame.width - ToastLayout.padding * 2, height: 26)
        panel.alphaValue = 1
        panel.orderFrontRegardless()
        hideWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            NSAnimationContext.runAnimationGroup({ $0.duration = 0.5; self?.panel.animator().alphaValue = 0 }, completionHandler: {
                self?.panel.orderOut(nil)
            })
        }
        hideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + ToastLayout.seconds, execute: work)
    }
}

// An edge or corner that resizes its window by dragging. The panel's own resize
// zone is covered by the web view, so the handles are explicit.
final class ResizeHandle: NSView {
    enum Edge: CaseIterable {
        case left, right, bottom, bottomLeft, bottomRight
        static let thickness: CGFloat = 8
        static let corner: CGFloat = 18

        func frame(in size: CGSize) -> CGRect {
            let t = Edge.thickness, c = Edge.corner
            switch self {
            case .left: return CGRect(x: 0, y: c, width: t, height: max(0, size.height - 2 * c))
            case .right: return CGRect(x: size.width - t, y: c, width: t, height: max(0, size.height - 2 * c))
            case .bottom: return CGRect(x: c, y: 0, width: max(0, size.width - 2 * c), height: t)
            case .bottomLeft: return CGRect(x: 0, y: 0, width: c, height: c)
            case .bottomRight: return CGRect(x: size.width - c, y: 0, width: c, height: c)
            }
        }
        var autoresizing: NSView.AutoresizingMask {
            switch self {
            case .left: return [.height]
            case .right: return [.minXMargin, .height]
            case .bottom: return [.width]
            case .bottomLeft: return []
            case .bottomRight: return [.minXMargin]
            }
        }
        var affectsLeft: Bool { self == .left || self == .bottomLeft }
        var affectsRight: Bool { self == .right || self == .bottomRight }
        var affectsBottom: Bool { self == .bottom || self == .bottomLeft || self == .bottomRight }
    }

    private let edge: Edge
    private let minSize: CGSize
    private var startFrame = CGRect.zero
    private var startMouse = CGPoint.zero

    init(edge: Edge, minSize: CGSize) {
        self.edge = edge
        self.minSize = minSize
        super.init(frame: .zero)
    }
    required init?(coder: NSCoder) { nil }

    override var mouseDownCanMoveWindow: Bool { false }
    override func resetCursorRects() {
        switch edge {
        case .left, .right: addCursorRect(bounds, cursor: .resizeLeftRight)
        case .bottom: addCursorRect(bounds, cursor: .resizeUpDown)
        case .bottomLeft, .bottomRight: addCursorRect(bounds, cursor: .crosshair)
        }
    }

    override func mouseDown(with event: NSEvent) {
        guard let window else { return }
        startFrame = window.frame
        startMouse = NSEvent.mouseLocation
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window else { return }
        let dx = NSEvent.mouseLocation.x - startMouse.x
        let dy = NSEvent.mouseLocation.y - startMouse.y
        var frame = startFrame
        if edge.affectsRight { frame.size.width = max(minSize.width, startFrame.width + dx) }
        if edge.affectsLeft {
            let width = max(minSize.width, startFrame.width - dx)
            frame.origin.x = startFrame.maxX - width
            frame.size.width = width
        }
        if edge.affectsBottom {
            let height = max(minSize.height, startFrame.height - dy)
            frame.origin.y = startFrame.maxY - height
            frame.size.height = height
        }
        window.setFrame(frame, display: true)
    }
}
