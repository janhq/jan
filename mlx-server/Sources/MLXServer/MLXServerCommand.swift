import ArgumentParser
import Foundation
import Hummingbird
import MLX

@main
struct MLXServerCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "mlx-server",
        abstract: "MLX-Swift inference server with OpenAI-compatible API"
    )

    @Option(name: [.long, .short], help: "Path to the GGUF model file")
    var model: String

    @Option(name: .long, help: "Port to listen on")
    var port: Int = 8080

    @Option(name: .long, help: "Context window size")
    var ctxSize: Int = 4096

    @Option(name: .long, help: "API key for authentication (optional)")
    var apiKey: String = ""

    @Option(name: .long, help: "Chat template to use (optional)")
    var chatTemplate: String = ""

    @Flag(name: .long, help: "Run in embedding mode")
    var embedding: Bool = false

    // MARK: - Batching Options

    @Option(name: .long, help: "Maximum batch size for concurrent requests (0 to disable)")
    var maxBatchSize: Int = 0

    @Flag(name: .long, help: "Enable continuous batching")
    var enableContinuousBatching: Bool = false

    func run() async throws {
        // Set GPU memory limit to prevent OOM issues
        Memory.cacheLimit = 20 * 1024 * 1024  // 20GB limit

        // Print startup info
        log("[mlx] MLX-Swift Server starting...")
        log("[mlx] Model path: \(model)")
        log("[mlx] Port: \(port)")
        log("[mlx] Context size: \(ctxSize)")
        log("[mlx] Memory cache limit: \(Memory.cacheLimit / (1024 * 1024))MB")

        // Print batching configuration if enabled
        if maxBatchSize > 0 {
            log("[mlx] Batching enabled:")
            log("  - Max batch size: \(maxBatchSize)")
            log("  - Continuous batching: \(enableContinuousBatching)")
        } else {
            log("[mlx] Batching disabled (sequential processing)")
        }

        // Extract model ID from path
        let modelURL = URL(fileURLWithPath: model)
        let modelId = modelURL.deletingPathExtension().lastPathComponent

        // Load the model
        let modelRunner = ModelRunner()

        do {
            try await modelRunner.load(modelPath: model, modelId: modelId)
        } catch {
            log("[mlx] Failed to load model: \(error)")
            throw error
        }

        // Warm up the model to initialize GPU kernels and optimize performance
        log("[mlx] Warming up model...")
        do {
            try await modelRunner.warmUp()
            log("[mlx] Model warm-up complete")
        } catch {
            log("[mlx] Warning: Model warm-up failed (\(error.localizedDescription)), continuing anyway...")
        }

        // Create batching configuration
        let batchingConfig: BatchingConfig?
        if maxBatchSize > 0 {
            batchingConfig = BatchingConfig(
                maxBatchSize: maxBatchSize,
                maxModelTokens: ctxSize,
                enableContinuousBatching: enableContinuousBatching,
            )
        } else {
            batchingConfig = nil
        }

        // Set up the HTTP server
        let server = MLXHTTPServer(
            modelRunner: modelRunner,
            modelId: modelId,
            apiKey: apiKey,
            batchingConfig: batchingConfig
        )

        let router = server.buildRouter()
        let app = Application(router: router, configuration: .init(address: .hostname("127.0.0.1", port: port)))

        // Print readiness signal (monitored by Tauri plugin)
        log("[mlx] http server listening on http://127.0.0.1:\(port)")
        log("[mlx] server is listening on 127.0.0.1:\(port)")

        try await app.run()
    }
}
