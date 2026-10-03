// swift-tools-version:6.0
import PackageDescription

// The macOS capture companion (ADR-0011, ADR-0012). It consumes only the
// versioned wire schema, holds no database or provider credentials, and has no
// third-party dependencies.
//
// The Command Line Tools toolchain ships neither Swift Testing nor XCTest, so
// the tests are an executable harness (`swift run capture-core-tests`) rather
// than a `.testTarget`; `swift test` therefore has nothing to run here.
let package = Package(
    name: "CaptureCompanion",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "CaptureCore", targets: ["CaptureCore"]),
        .library(name: "CaptureAdapters", targets: ["CaptureAdapters"]),
        .executable(name: "capture-companion", targets: ["capture-companion"]),
        .executable(name: "capture-core-tests", targets: ["CaptureCoreTests"]),
    ],
    targets: [
        .target(name: "CaptureCore", path: "Sources/CaptureCore"),
        .target(
            name: "CaptureAdapters",
            dependencies: ["CaptureCore"],
            path: "Sources/CaptureAdapters"
        ),
        .executableTarget(
            name: "capture-companion",
            dependencies: ["CaptureCore", "CaptureAdapters"],
            path: "Sources/capture-companion"
        ),
        .executableTarget(
            name: "CaptureCoreTests",
            dependencies: ["CaptureCore"],
            path: "Tests/CaptureCoreTests"
        ),
    ],
    swiftLanguageModes: [.v6]
)
