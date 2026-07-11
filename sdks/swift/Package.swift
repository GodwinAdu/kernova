// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Kernova",
    platforms: [
        .macOS(.v13),
        .iOS(.v16),
    ],
    products: [
        .library(
            name: "Kernova",
            targets: ["Kernova"]
        ),
    ],
    targets: [
        .target(
            name: "Kernova",
            path: "Sources/Kernova"
        ),
    ]
)
