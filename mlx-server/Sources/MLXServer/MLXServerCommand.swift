import ArgumentParser
import Foundation
import Hummingbird

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

    func run() async throws {
        // Print startup info
        print("[mlx] MLX-Swift Server starting...")
        print("[mlx] Model path: \(model)")
        print("[mlx] Port: \(port)")
        print("[mlx] Context size: \(ctxSize)")

        // Extract model ID from path
        let modelURL = URL(fileURLWithPath: model)
        let modelId = modelURL.deletingPathExtension().lastPathComponent

        // Load the model
        let modelRunner = ModelRunner()

        do {
            try await modelRunner.load(modelPath: model, modelId: modelId)
        } catch {
            print("[mlx] Failed to load model: \(error)")
            throw error
        }

        // Set up the HTTP server
        let server = MLXHTTPServer(
            modelRunner: modelRunner,
            modelId: modelId,
            apiKey: apiKey
        )

        let router = server.buildRouter()
        let app = Application(router: router, configuration: .init(address: .hostname("127.0.0.1", port: port)))

        // Print readiness signal (monitored by Tauri plugin)
        print("[mlx] http server listening on http://127.0.0.1:\(port)")
        print("[mlx] server is listening on 127.0.0.1:\(port)")

        try await app.run()
    }
}
