import Foundation
import MLX
import MLXLLM
import MLXLMCommon
import MLXRandom
import MLXVLM

/// Manages loading and running inference with MLX models
actor ModelRunner {
    private var container: ModelContainer?
    private var modelId: String = ""

    var isLoaded: Bool {
        container != nil
    }

    var currentModelId: String {
        modelId
    }

    /// Load a model from the given path, trying LLM first then VLM
    func load(modelPath: String, modelId: String) async throws {
        print("[mlx] Loading model from: \(modelPath)")

        let modelURL = URL(fileURLWithPath: modelPath)
        let modelDir = modelURL.deletingLastPathComponent()
        let configuration = ModelConfiguration(directory: modelDir, defaultPrompt: "")

        // Try LLM factory first, fall back to VLM factory
        do {
            self.container = try await LLMModelFactory.shared.loadContainer(
                configuration: configuration
            ) { progress in
                print("[mlx] Loading progress: \(Int(progress.fractionCompleted * 100))%")
            }
            print("[mlx] Model loaded as LLM: \(modelId)")
        } catch {
            print("[mlx] LLM loading failed (\(error.localizedDescription)), trying VLM factory...")
            do {
                self.container = try await VLMModelFactory.shared.loadContainer(
                    configuration: configuration
                ) { progress in
                    print("[mlx] Loading progress: \(Int(progress.fractionCompleted * 100))%")
                }
                print("[mlx] Model loaded as VLM: \(modelId)")
            } catch {
                print("[mlx] Error: Failed to load model with both LLM and VLM factories: \(error.localizedDescription)")
                throw error
            }
        }

        self.modelId = modelId
        print("[mlx] Model ready: \(modelId)")
    }

    /// Build Chat.Message array from ChatMessages, including images and videos
    private func buildChat(from messages: [ChatMessage]) -> [Chat.Message] {
        messages.map { message in
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

            let images: [UserInput.Image] = (message.images ?? []).compactMap { urlString in
                guard let url = URL(string: urlString) else {
                    print("[mlx] Warning: Invalid image URL: \(urlString)")
                    return nil
                }
                return .url(url)
            }

            let videos: [UserInput.Video] = (message.videos ?? []).compactMap { urlString in
                guard let url = URL(string: urlString) else {
                    print("[mlx] Warning: Invalid video URL: \(urlString)")
                    return nil
                }
                return .url(url)
            }

            if !images.isEmpty {
                print("[mlx] Message has \(images.count) image(s)")
            }
            if !videos.isEmpty {
                print("[mlx] Message has \(videos.count) video(s)")
            }

            return Chat.Message(
                role: role, content: message.content ?? "", images: images, videos: videos)
        }
    }

    /// Convert AnyCodable tools array to ToolSpec format
    private func buildToolSpecs(from tools: [AnyCodable]?) -> [[String: any Sendable]]? {
        guard let tools = tools, !tools.isEmpty else { return nil }
        let specs = tools.map { tool in
            tool.toSendable() as! [String: any Sendable]
        }
        print("[mlx] Tools provided: \(specs.count)")
        return specs
    }

    /// Generate a chat completion (non-streaming)
    func generate(
        messages: [ChatMessage],
        temperature: Float = 0.7,
        topP: Float = 1.0,
        maxTokens: Int = 2048,
        repetitionPenalty: Float = 1.0,
        stop: [String] = [],
        tools: [AnyCodable]? = nil
    ) async throws -> (String, [ToolCallInfo], UsageInfo) {
        guard let container = container else {
            print("[mlx] Error: generate() called but no model is loaded")
            throw MLXServerError.modelNotLoaded
        }

        print("[mlx] Generate: \(messages.count) messages, temp=\(temperature), topP=\(topP), maxTokens=\(maxTokens)")

        let chat = buildChat(from: messages)
        let toolSpecs = buildToolSpecs(from: tools)

        let generateParameters = GenerateParameters(
            maxTokens: maxTokens,
            temperature: temperature,
            topP: topP,
            repetitionPenalty: repetitionPenalty
        )
        let userInput = UserInput(
            chat: chat,
            processing: .init(resize: .init(width: 1024, height: 1024)),
            tools: toolSpecs
        )

        let result: (String, [ToolCallInfo], UsageInfo) = try await container.perform { context in
            let input = try await context.processor.prepare(input: userInput)
            let promptTokenCount = input.text.tokens.size

            var output = ""
            var completionTokenCount = 0
            var collectedToolCalls: [ToolCallInfo] = []
            var completionInfo: GenerateCompletionInfo?

            do {
                for await generation in try MLXLMCommon.generate(
                    input: input, parameters: generateParameters, context: context
                ) {
                    switch generation {
                    case .chunk(let chunk):
                        output += chunk
                        completionTokenCount += 1

                        // Check stop sequences
                        var hitStop = false
                        for s in stop where output.hasSuffix(s) {
                            output = String(output.dropLast(s.count))
                            hitStop = true
                            print("[mlx] Hit stop sequence: \"\(s)\"")
                            break
                        }
                        if hitStop { break }

                    case .info(let info):
                        completionInfo = info
                        print("[mlx] Generation info: \(info.promptTokenCount) prompt tokens, \(info.generationTokenCount) generated tokens")
                        print("[mlx]   Prompt: \(String(format: "%.1f", info.promptTokensPerSecond)) tokens/sec")
                        print("[mlx]   Generation: \(String(format: "%.1f", info.tokensPerSecond)) tokens/sec")

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
                        print("[mlx] Tool call: \(toolCall.function.name)(\(argsString))")
                    }
                }
            } catch {
                print("[mlx] Error during generation: \(error.localizedDescription)")
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
                    prompt_tokens: promptTokenCount,
                    completion_tokens: completionTokenCount,
                    total_tokens: promptTokenCount + completionTokenCount
                )
            }

            print("[mlx] Generate complete: \(output.count) chars, \(collectedToolCalls.count) tool call(s)")
            return (output, collectedToolCalls, usage)
        }

        return result
    }

    /// Generate a streaming chat completion
    func generateStream(
        messages: [ChatMessage],
        temperature: Float = 0.7,
        topP: Float = 1.0,
        maxTokens: Int = 2048,
        repetitionPenalty: Float = 1.0,
        stop: [String] = [],
        tools: [AnyCodable]? = nil
    ) -> AsyncThrowingStream<StreamEvent, Error> {
        AsyncThrowingStream { continuation in
            Task {
                guard let container = self.container else {
                    print("[mlx] Error: generateStream() called but no model is loaded")
                    continuation.finish(throwing: MLXServerError.modelNotLoaded)
                    return
                }

                print("[mlx] Stream generate: \(messages.count) messages, temp=\(temperature), topP=\(topP), maxTokens=\(maxTokens)")

                let chat = self.buildChat(from: messages)
                let toolSpecs = self.buildToolSpecs(from: tools)

                let userInput = UserInput(
                    chat: chat,
                    processing: .init(resize: .init(width: 1024, height: 1024)),
                    tools: toolSpecs
                )

                do {
                    try await container.perform { context in
                        let generateParameters = GenerateParameters(
                            maxTokens: maxTokens,
                            temperature: temperature,
                            topP: topP,
                            repetitionPenalty: repetitionPenalty
                        )

                        let input = try await context.processor.prepare(input: userInput)

                        var completionTokenCount = 0
                        var accumulated = ""
                        var hasToolCalls = false

                        do {
                            for await generation in try MLXLMCommon.generate(
                                input: input, parameters: generateParameters, context: context
                            ) {
                                switch generation {
                                case .chunk(let chunk):
                                    accumulated += chunk
                                    completionTokenCount += 1

                                    continuation.yield(.chunk(chunk))

                                    // Check stop sequences
                                    var hitStop = false
                                    for s in stop where accumulated.hasSuffix(s) {
                                        hitStop = true
                                        print("[mlx] Hit stop sequence: \"\(s)\"")
                                        break
                                    }
                                    if hitStop { break }

                                case .info(let info):
                                    print("[mlx] Stream generation info: \(info.promptTokenCount) prompt tokens, \(info.generationTokenCount) generated tokens")
                                    print("[mlx]   Prompt: \(String(format: "%.1f", info.promptTokensPerSecond)) tokens/sec")
                                    print("[mlx]   Generation: \(String(format: "%.1f", info.tokensPerSecond)) tokens/sec")

                                    let usage = UsageInfo(
                                        prompt_tokens: info.promptTokenCount,
                                        completion_tokens: info.generationTokenCount,
                                        total_tokens: info.promptTokenCount + info.generationTokenCount
                                    )
                                    let timings = TimingsInfo(
                                        prompt_n: info.promptTokenCount,
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
                                    print("[mlx] Stream tool call: \(toolCall.function.name)(\(argsString))")
                                    continuation.yield(.toolCall(info))
                                }
                            }
                        } catch {
                            print("[mlx] Error during stream generation: \(error.localizedDescription)")
                            throw error
                        }

                        // If no .info was received, send done with fallback usage
                        // The .info case already yields .done, so only send if we haven't
                        print("[mlx] Stream complete: \(accumulated.count) chars")
                        continuation.finish()
                    }
                } catch {
                    print("[mlx] Error in stream: \(error.localizedDescription)")
                    continuation.finish(throwing: error)
                }
            }
        }
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
