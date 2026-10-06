import Foundation

// [DOMAIN] What makes a native window genuinely see-through. Every layer from the
// window to the page must be non-opaque with a clear background; the page itself
// paints the translucent tint.
public struct PanelChromeSnapshot: Equatable, Sendable {
    public var windowIsOpaque: Bool
    public var windowBackgroundAlpha: Double
    public var windowHasShadow: Bool
    public var webViewDrawsBackground: Bool
    public var webViewUnderPageAlpha: Double
    // The alpha of any other view or layer background found between the content
    // view and the page (each entry one opaque-ish layer).
    public var otherBackgroundAlphas: [Double]

    public init(
        windowIsOpaque: Bool, windowBackgroundAlpha: Double, windowHasShadow: Bool, webViewDrawsBackground: Bool,
        webViewUnderPageAlpha: Double, otherBackgroundAlphas: [Double]
    ) {
        self.windowIsOpaque = windowIsOpaque
        self.windowBackgroundAlpha = windowBackgroundAlpha
        self.windowHasShadow = windowHasShadow
        self.webViewDrawsBackground = webViewDrawsBackground
        self.webViewUnderPageAlpha = webViewUnderPageAlpha
        self.otherBackgroundAlphas = otherBackgroundAlphas
    }

    // The configuration every panel is built to.
    public static let intended = PanelChromeSnapshot(
        windowIsOpaque: false, windowBackgroundAlpha: 0, windowHasShadow: false, webViewDrawsBackground: false,
        webViewUnderPageAlpha: 0, otherBackgroundAlphas: [])
}

public enum PanelChrome {
    // [GUARD] Names every way a panel would be opaque; empty means see-through.
    public static func violations(_ s: PanelChromeSnapshot) -> [String] {
        var out: [String] = []
        if s.windowIsOpaque { out.append("window is opaque") }
        if s.windowBackgroundAlpha > 0 { out.append("window background is not clear") }
        if s.windowHasShadow { out.append("window has a system shadow (it strokes the content shape)") }
        if s.webViewDrawsBackground { out.append("web view draws a background") }
        if s.webViewUnderPageAlpha > 0 { out.append("web view under-page colour is not clear") }
        if s.otherBackgroundAlphas.contains(where: { $0 > 0 }) { out.append("an opaque layer sits behind the page") }
        return out
    }
}
