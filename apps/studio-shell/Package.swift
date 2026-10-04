// swift-tools-version:6.0
import PackageDescription

// The native shell for Interview Studio (ADR-0019). It hosts the one overlay
// route (ADR-0017) in a floating panel and fulfils screen capture for the page
// through the host adapter; it owns no session state, makes no assist request
// and calls no model. Capture is the capture companion's own module
// (ScreenKitOneShot), shared by path rather than copied.
//
// The Command Line Tools toolchain ships neither Swift Testing nor XCTest, so
// the tests are an executable harness (`swift run studio-shell-tests`), as in
// the capture companion.
let package = Package(
    name: "StudioShell",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "StudioShellCore", targets: ["StudioShellCore"]),
        .executable(name: "studio-shell", targets: ["studio-shell"]),
        .executable(name: "studio-shell-tests", targets: ["StudioShellTests"]),
    ],
    dependencies: [
        .package(path: "../capture-companion/macos"),
    ],
    targets: [
        .target(
            name: "StudioShellCore",
            dependencies: [
                .product(name: "CaptureCore", package: "macos"),
                .product(name: "CaptureAdapters", package: "macos"),
            ],
            path: "Sources/StudioShellCore"
        ),
        // AppKit, WebKit and Carbon callbacks are main-thread C and Objective-C
        // APIs; the shell is written for the Swift 5 concurrency model. All
        // decisions live in StudioShellCore, which is Swift 6.
        // The embedded hands-free engine (owner-route pairing, the companion's
        // session and sources). A library so the engine's state machine is tested
        // with fakes; the shell target excludes its folder.
        .target(
            name: "StudioShellEngine",
            dependencies: [
                "StudioShellCore",
                .product(name: "CaptureCore", package: "macos"),
                .product(name: "CaptureAdapters", package: "macos"),
            ],
            path: "Sources/studio-shell/Engine"
        ),
        .executableTarget(
            name: "studio-shell",
            dependencies: [
                "StudioShellCore",
                "StudioShellEngine",
                .product(name: "CaptureCore", package: "macos"),
                .product(name: "CaptureAdapters", package: "macos"),
            ],
            path: "Sources/studio-shell",
            exclude: ["Engine"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .executableTarget(
            name: "StudioShellTests",
            dependencies: [
                "StudioShellCore",
                "StudioShellEngine",
                .product(name: "CaptureCore", package: "macos"),
                .product(name: "CaptureAdapters", package: "macos"),
            ],
            path: "Tests/StudioShellTests"
        ),
    ],
    swiftLanguageModes: [.v6]
)
