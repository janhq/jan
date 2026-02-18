import Foundation
import MLX
import MLXLLM
import MLXLMCommon
import MLXVLM

/// Manages loading and running inference with MLX models
actor ModelRunner {
    private var model: ModelContext?

    /// Load a model from the given path
    /// Supports both local directories and HuggingFace model IDs
    func load(modelPath: String) async throws {
        log("[mlx] Loading model from: \(modelPath)")

        let modelURL = URL(fileURLWithPath: modelPath)
        let fileManager = FileManager.default

        var isDirectory: ObjCBool = false
        let pathExists = fileManager.fileExists(atPath: modelPath, isDirectory: &isDirectory)

        var modelDir: URL?

        if pathExists && isDirectory.boolValue {
            let configURL = modelURL.appendingPathComponent("config.json")
            if fileManager.fileExists(atPath: configURL.path) {
                modelDir = modelURL
                log("[mlx] Using local model directory: \(modelURL.path)")
            } else {
                // Try parent directory
                let parentDir = modelURL.deletingLastPathComponent()
                let parentConfigURL = parentDir.appendingPathComponent("config.json")
                if fileManager.fileExists(atPath: parentConfigURL.path) {
                    modelDir = parentDir
                    log("[mlx] Using parent directory: \(parentDir.path)")
                }
            }
        } else if pathExists {
            // Single file - use parent directory
            modelDir = modelURL.deletingLastPathComponent()
            log("[mlx] Using parent directory: \(modelDir!.path)")
        }

        if let dir = modelDir {
            self.model = try await loadModel(directory: dir)
        }
    }

    /// Parse ChatMessages into system instructions, conversation history, and the current user message
    private func buildChat(from messages: [ChatMessage]) -> (instructions: String?, history: [Chat.Message], current: Chat.Message?) {
        let chatMessages = messages.map { toChatMessage($0) }
        let instructions = chatMessages.first(where: { $0.role == .system })?.content
        let nonSystem = chatMessages.filter { $0.role != .system }
        let history = nonSystem.dropLast()
        let current = nonSystem.last
        return (instructions, Array(history), current)
    }

    /// Convert a single ChatMessage to Chat.Message
    private func toChatMessage(_ message: ChatMessage) -> Chat.Message {
        let role: Chat.Message.Role =
        switch message.role {
        case "assistant":
                .assistant
        case "user":
                .user
        case "system":
                .system
        case "tool":
                .tool
        default:
                .user
        }

        // Get image URLs from both explicit images field and content array format
        var imageUrls = message.content.imageUrls
        if let legacyImages = message.images {
            imageUrls.append(contentsOf: legacyImages)
        }

        let images: [UserInput.Image] = imageUrls.compactMap { urlString in
            // Handle file:// URLs
            let cleanUrl = urlString.replacingOccurrences(of: "file://", with: "")
            guard let url = URL(string: urlString) ?? URL(string: cleanUrl) else {
                log("[mlx] Warning: Invalid image URL: \(urlString)")
                return nil
            }
            return .url(url)
        }

        let videos: [UserInput.Video] = (message.videos ?? []).compactMap { urlString in
            guard let url = URL(string: urlString) else {
                log("[mlx] Warning: Invalid video URL: \(urlString)")
                return nil
            }
            return .url(url)
        }

        if !images.isEmpty {
            log("[mlx] Message has \(images.count) image(s)")
        }
        if !videos.isEmpty {
            log("[mlx] Message has \(videos.count) video(s)")
        }

        return Chat.Message(
            role: role, content: message.content.textContent, images: images, videos: videos)
    }

    /// Build GenerateParameters from individual parameters
    private nonisolated func buildGenerateParameters(
        temperature: Float,
        topP: Float,
        maxTokens: Int? = nil,
        repetitionPenalty: Float
    ) -> GenerateParameters {
        GenerateParameters(
            maxTokens: maxTokens,
            kvBits: 4,           // 4 or 8 bits
            kvGroupSize: 64,     // Quantization group size
            quantizedKVStart: 0,  // Start quantizing after N tokens
            temperature: temperature,
            topP: topP,
            repetitionPenalty: repetitionPenalty,
        )
    }

    /// Generate a chat completion (non-streaming)
    func generate(
        messages: [ChatMessage],
        temperature: Float = 0.7,
        topP: Float = 1.0,
        maxTokens: Int? = nil,
        repetitionPenalty: Float = 1.0,
        stop: [String] = [],
        tools: [AnyCodable]? = nil
    ) async throws -> (String, [ToolCallInfo], UsageInfo) {

        guard let model = self.model else {
            log("[mlx] Error: generate() called but no model is loaded")
            throw MLXServerError.modelNotLoaded
        }

        log("[mlx] Generate: \(messages.count) messages, temp=\(temperature), topP=\(topP), maxTokens=\(maxTokens ?? -1)")

        let (instructions, history, currentMessage) = buildChat(from: messages)

        let generateParameters = buildGenerateParameters(
            temperature: temperature, topP: topP,
            maxTokens: maxTokens, repetitionPenalty: repetitionPenalty
        )

        let toolSpecs = self.buildToolSpecs(from: tools)
        let session = ChatSession(model, instructions: instructions, history: history, generateParameters: generateParameters, tools: toolSpecs)

        var output = ""
        var completionTokenCount = 0
        var collectedToolCalls: [ToolCallInfo] = []
        var completionInfo: GenerateCompletionInfo?

        do {
            for try await item in session.streamDetails(to: currentMessage?.content ?? "", images: currentMessage?.images ?? [], videos: []) {
                try Task.checkCancellation()

                switch item {
                case .chunk(let chunk):
                    output += chunk
                    completionTokenCount += 1

                case .info(let info):
                    completionInfo = info
                    log("[mlx] Generation info: \(info.promptTokenCount) processed prompt tokens, \(info.generationTokenCount) generated tokens")
                    log("[mlx] Prompt: \(String(format: "%.1f", info.promptTokensPerSecond)) tokens/sec")
                    log("[mlx] Generation: \(String(format: "%.1f", info.tokensPerSecond)) tokens/sec")

                case .toolCall(let toolCall):
                    let argsData = try JSONSerialization.data(
                        withJSONObject: toolCall.function.arguments.mapValues { $0.anyValue },
                        options: [.sortedKeys]
                    )
                    let argsString = String(data: argsData, encoding: .utf8) ?? "{}"
                    let info = ToolCallInfo(
                        id: generateToolCallId(),
                        type: "function",
                        function: FunctionCall(
                            name: toolCall.function.name,
                            arguments: argsString
                        )
                    )
                    collectedToolCalls.append(info)
                    log("[mlx] Tool call: \(toolCall.function.name)(\(argsString))")
                }
            }
        } catch is CancellationError {
            log("[mlx] Generation cancelled by client")
            throw CancellationError()
        } catch {
            log("[mlx] Error during generation: \(error.localizedDescription)")
            throw error
        }

        let usage: UsageInfo
        if let info = completionInfo {
            usage = UsageInfo(
                prompt_tokens: info.promptTokenCount,
                completion_tokens: info.generationTokenCount,
                total_tokens: info.promptTokenCount + info.generationTokenCount
            )
        } else {
            usage = UsageInfo(
                prompt_tokens: completionTokenCount,
                completion_tokens: completionTokenCount,
                total_tokens: completionTokenCount + completionTokenCount
            )
        }

        log("[mlx] Generate complete: \(output.count) chars, \(collectedToolCalls.count) tool call(s)")
        return (output, collectedToolCalls, usage)
    }

    /// Generate a streaming chat completion
    func generateStream(
        messages: [ChatMessage],
        temperature: Float = 0.7,
        topP: Float = 1.0,
        maxTokens: Int? = nil,
        repetitionPenalty: Float = 1.0,
        stop: [String] = [], // Skipped for now, later should pass thru model load where container preparation - context.configuration.extraEOSTokens
        tools: [AnyCodable]? = nil
    ) -> AsyncThrowingStream<StreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                guard let model = model else {
                    log("[mlx] Error: generate() called but no model is loaded")
                    throw MLXServerError.modelNotLoaded
                }

                log("[mlx] Generate: \(messages.count) messages, temp=\(temperature), topP=\(topP), maxTokens=\(maxTokens ?? -1)")
                let (instructions, history, currentMessage) = buildChat(from: messages)

                let generateParameters = self.buildGenerateParameters(
                    temperature: temperature, topP: topP,
                    maxTokens: maxTokens, repetitionPenalty: repetitionPenalty
                )

                let toolSpecs = self.buildToolSpecs(from: tools)
                let session = ChatSession(model, instructions: instructions, history: history, generateParameters: generateParameters, tools: toolSpecs)

                var completionTokenCount = 0
                var hasToolCalls = false
                do {
                    for try await item in session.streamDetails(to: currentMessage?.content ?? "", images: currentMessage?.images ?? [], videos: []) {

                        if Task.isCancelled {
                            log("[mlx] Stream generation cancelled by client")
                            break
                        }

                        switch item {
                        case .chunk(let chunk):
                            completionTokenCount += 1

                            continuation.yield(.chunk(chunk))

                        case .info(let info):
                            log("[mlx] Stream generation info: \(info.promptTokenCount) processed prompt tokens, \(info.generationTokenCount) generated tokens")
                            log("[mlx] Prompt: \(String(format: "%.1f", info.promptTokensPerSecond)) tokens/sec")
                            log("[mlx] Generation: \(String(format: "%.1f", info.tokensPerSecond)) tokens/sec")

                            // Use full prompt token count for accurate usage tracking
                            //                        let promptTokenCount = fullTokens.size
                            let usage = UsageInfo(
                                prompt_tokens: nil,
                                //                            prompt_tokens: promptTokenCount,
                                completion_tokens: info.generationTokenCount,
                                total_tokens: nil
                                //                            total_tokens: promptTokenCount + info.generationTokenCount
                            )
                            let timings = TimingsInfo(
                                //                            prompt_n: promptTokenCount,
                                predicted_n: info.generationTokenCount,
                                predicted_per_second: info.tokensPerSecond,
                                prompt_per_second: info.promptTokensPerSecond
                            )
                            continuation.yield(.done(usage: usage, timings: timings, hasToolCalls: hasToolCalls))

                        case .toolCall(let toolCall):
                            hasToolCalls = true
                            let argsData = try JSONSerialization.data(
                                withJSONObject: toolCall.function.arguments.mapValues { $0.anyValue },
                                options: [.sortedKeys]
                            )
                            let argsString = String(data: argsData, encoding: .utf8) ?? "{}"
                            let info = ToolCallInfo(
                                id: generateToolCallId(),
                                type: "function",
                                function: FunctionCall(
                                    name: toolCall.function.name,
                                    arguments: argsString
                                )
                            )
                            log("[mlx] Stream tool call: \(toolCall.function.name)(\(argsString))")
                            continuation.yield(.toolCall(info))
                        }
                    }
                    continuation.finish()
                } catch {
                    if Task.isCancelled {
                        log("[mlx] Stream generation cancelled by client")
                        continuation.finish()
                    } else {
                        log("[mlx] Error during stream generation: \(error.localizedDescription)")
                        continuation.finish(throwing: error)
                    }
                }
            }

            // Cancel the generation task when the stream consumer stops (client disconnect)
            continuation.onTermination = { @Sendable _ in
                task.cancel()
            }
        }
    }
    /// Convert AnyCodable tools array to ToolSpec format
    private func buildToolSpecs(from tools: [AnyCodable]?) -> [[String: any Sendable]]? {
        guard let tools = tools, !tools.isEmpty else { return nil }
        let specs = tools.map { tool in
            tool.toSendable() as! [String: any Sendable]
        }
        log("[mlx] Tools provided: \(specs.count)")
        return specs
    }
}
/// Events emitted during streaming generation
enum StreamEvent {
    /// A text chunk
    case chunk(String)
    /// A tool call from the model
    case toolCall(ToolCallInfo)
    /// Generation complete with usage and timing info
    case done(usage: UsageInfo, timings: TimingsInfo?, hasToolCalls: Bool)
}

enum MLXServerError: Error, LocalizedError {
    case modelNotLoaded
    case invalidRequest(String)

    var errorDescription: String? {
        switch self {
        case .modelNotLoaded:
            return "No model is currently loaded"
        case .invalidRequest(let msg):
            return "Invalid request: \(msg)"
        }
    }
}

