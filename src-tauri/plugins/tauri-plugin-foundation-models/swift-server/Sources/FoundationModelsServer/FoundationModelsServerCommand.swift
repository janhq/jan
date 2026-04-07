import ArgumentParser
import Foundation
import Hummingbird
import FoundationModels

@main
struct FoundationModelsServerCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "foundation-models-server",
        abstract: "Apple Foundation Models inference server with OpenAI-compatible API"
    )

    @Option(name: .long, help: "Port to listen on")
    var port: Int = 8080

    @Option(name: .long, help: "API key for authentication (optional)")
    var apiKey: String = ""

    @Flag(name: .long, help: "Check availability and exit with status 0 if available")
    var check: Bool = false

    func run() async throws {
        let availability = SystemLanguageModel.default.availability

        // In --check mode, always print a machine-readable status token and exit 0.
        // Callers (e.g. the Tauri plugin) parse this string to decide visibility.
        if check {
            switch availability {
            case .available:
                print("available")
            case .unavailable(.deviceNotEligible):
                print("notEligible")
            case .unavailable(.appleIntelligenceNotEnabled):
                print("appleIntelligenceNotEnabled")
            case .unavailable(.modelNotReady):
                print("modelNotReady")
            default:
                print("unavailable")
            }
            return
        }

        guard case .available = availability else {
            let reason: String
            switch availability {
            case .unavailable(.deviceNotEligible):
                reason = "Device is not eligible for Apple Intelligence"
            case .unavailable(.appleIntelligenceNotEnabled):
                reason = "Apple Intelligence is not enabled in System Settings"
            case .unavailable(.modelNotReady):
                reason = "Foundation model is downloading or not yet ready"
            default:
                reason = "Foundation model is unavailable on this system"
            }
            fputs("[foundation-models] ERROR: \(reason)\n", stderr)
            throw ExitCode(1)
        }

        log("[foundation-models] Foundation Models Server starting...")
        log("[foundation-models] Port: \(port)")

        let server = FoundationModelsHTTPServer(
            modelId: "apple/on-device",
            apiKey: apiKey
        )

        let router = server.buildRouter()
        let app = Application(
            router: router,
            configuration: .init(address: .hostname("127.0.0.1", port: port))
        )

        log("[foundation-models] http server listening on http://127.0.0.1:\(port)")
        log("[foundation-models] server is listening on 127.0.0.1:\(port)")

        try await app.run()
    }
}
