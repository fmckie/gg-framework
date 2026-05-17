// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "GGPixel",
    platforms: [
        .iOS(.v13),
        .macOS(.v10_15),
        .tvOS(.v13),
        .watchOS(.v6),
    ],
    products: [
        .library(name: "GGPixel", targets: ["GGPixel"]),
        .executable(name: "ggpixel-smoke", targets: ["GGPixelSmoke"]),
    ],
    targets: [
        .target(
            name: "GGPixel",
            path: "Sources/GGPixel"
        ),
        .executableTarget(
            name: "GGPixelSmoke",
            dependencies: ["GGPixel"],
            path: "Sources/GGPixelSmoke"
        ),
        .testTarget(
            name: "GGPixelTests",
            dependencies: ["GGPixel"],
            path: "Tests/GGPixelTests"
        ),
    ]
)
