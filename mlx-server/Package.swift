// swift-tools-version: 5.12

import PackageDescription

let package = Package(
    name: "mlx-server",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "mlx-server", targets: ["MLXServer"])
    ],
    dependencies: [
        .package(url: "https://github.com/ml-explore/mlx-swift", .upToNextMinor(from: "0.31.4")),
        // Pinned to a release tag, not `main`: main drifted onto mlx-swift 0.31.5+
        // APIs (MLXArray.maskFill, DType.greatestFiniteMagnitudeArray) our floor
        // doesn't guarantee. 3.31.4 matches main's loadModel/ChatSession APIs.
        .package(url: "https://github.com/ml-explore/mlx-swift-lm", exact: "3.31.4"),
        .package(url: "https://github.com/huggingface/swift-transformers", from: "1.3.0"),
        // Pin transitive swift-jinja: 2.4.0 changed Value.object keys from String to
        // ObjectKey, which fails to build against swift-transformers 1.3.3's jinjaValue().
        .package(url: "https://github.com/huggingface/swift-jinja.git", "2.3.0"..<"2.4.0"),
        .package(url: "https://github.com/apple/swift-argument-parser", from: "1.7.0"),
        .package(url: "https://github.com/hummingbird-project/hummingbird", from: "2.19.0"),
        // Pin Hummingbird's transitive tracing packages: swift-distributed-tracing 1.6.0
        // stopped depending on swift-service-context (1.4.0 inverted the edge), so
        // Hummingbird 2.27.1's `import ServiceContextModule` no longer resolves. Drop
        // once a Hummingbird release requires sdt 1.6 (hummingbird-project/hummingbird#922).
        .package(url: "https://github.com/apple/swift-distributed-tracing.git", "1.3.0"..<"1.6.0"),
        .package(url: "https://github.com/apple/swift-service-context.git", "1.1.0"..<"1.4.0"),
    ],
    targets: [
        .executableTarget(
            name: "MLXServer",
            dependencies: [
                .product(name: "MLX", package: "mlx-swift"),
                .product(name: "MLXNN", package: "mlx-swift"),
                .product(name: "MLXLLM", package: "mlx-swift-lm"),
                .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
                .product(name: "MLXVLM", package: "mlx-swift-lm"),
                .product(name: "Tokenizers", package: "swift-transformers"),
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
                .product(name: "Hummingbird", package: "hummingbird"),
            ],
            path: "Sources/MLXServer"
        )
    ]
)
