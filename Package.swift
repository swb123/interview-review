// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "InterviewReview",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "InterviewReview",
            path: "Sources/InterviewReview"
        )
    ]
)
