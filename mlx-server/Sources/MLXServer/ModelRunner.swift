import Foundation
import MLX
import MLXLLM
import MLXLMCommon
import MLXVLM

/// Manages loading and running inference with MLX models
actor ModelRunner {
    private var container: ModelContainer?
    private var modelId: String = ""
    private var promptCache: [String: PromptCache] = [:]

    var isLoaded: Bool {
        container != nil
    }

    var currentModelId: String {
        modelId
    }

    /// Clear the prompt cache when loading a new model
    private func clearPromptCache() {
        promptCache.removeAll()
        log("[mlx] Prompt cache cleared")
    }

    /// Warm up the model by running a short generation to initialize GPU kernels
    func warmUp() async throws {
        guard let container = container else {
            throw MLXServerError.modelNotLoaded
        }
        log("[mlx] Running warm-up generation...")

        let warmUpMessages = [ChatMessage(role: "user", content: "Hello")]
        let warmUpParameters = GenerateParameters(
            maxTokens: 1,
            temperature: 0.1,
            topP: 0.9,
            repetitionPenalty: 1.0
        )

        let warmUpInput = UserInput(
            chat: buildChat(from: warmUpMessages),
            processing: .init(resize: .init(width: 1024, height: 1024)),
            tools: nil
        )

        try await container.perform { context in
            let input = try await context.processor.prepare(input: warmUpInput)

            for try await _ in try MLXLMCommon.generate(
                input: input, parameters: warmUpParameters, context: context
            ) {
                // Consume the stream - we only need one token to warm up
                break
            }
        }

        log("[mlx] Warm-up complete")
    }

    /// Load a model from the given path, trying LLM first then VLM
    func load(modelPath: String, modelId: String) async throws {
        log("[mlx] Loading model from: \(modelPath)")

        let modelURL = URL(fileURLWithPath: modelPath)
        let modelDir = modelURL.deletingLastPathComponent()
        let configuration = ModelConfiguration(directory: modelDir, defaultPrompt: "")

        // Try LLM factory first, fall back to VLM factory
        do {
            self.container = try await LLMModelFactory.shared.loadContainer(
                configuration: configuration
            ) { progress in
                log("[mlx] Loading progress: \(Int(progress.fractionCompleted * 100))%")
            }
            log("[mlx] Model loaded as LLM: \(modelId)")
        } catch {
            log("[mlx] LLM loading failed (\(error.localizedDescription)), trying VLM factory...")
            do {
                self.container = try await VLMModelFactory.shared.loadContainer(
                    configuration: configuration
                ) { progress in
                    log("[mlx] Loading progress: \(Int(progress.fractionCompleted * 100))%")
                }
                log("[mlx] Model loaded as VLM: \(modelId)")
            } catch {
                log("[mlx] Error: Failed to load model with both LLM and VLM factories: \(error.localizedDescription)")
                throw error
            }
        }

        self.modelId = modelId
        log("[mlx] Model ready: \(modelId)")

        // Clear prompt cache when loading a new model
        clearPromptCache()
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
                role: role, content: message.content ?? "", images: images, videos: videos)
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

    /// Build GenerateParameters from individual parameters
    private nonisolated func buildGenerateParameters(
        temperature: Float,
        topP: Float,
        maxTokens: Int,
        repetitionPenalty: Float
    ) -> GenerateParameters {
        GenerateParameters(
            maxTokens: maxTokens,
            temperature: temperature,
            topP: topP,
            repetitionPenalty: repetitionPenalty
        )
    }

    /// Get or create a prompt cache for the current model
    private func getPromptCache(context: ModelContext, parameters: GenerateParameters) -> PromptCache {
        if let existingCache = promptCache[modelId] {
            return existingCache
        }
        // Create new cache with the model's KV cache structure
        let modelCache = context.model.newCache(parameters: parameters)
        let newCache = PromptCache(cache: modelCache)
        promptCache[modelId] = newCache
        log("[mlx] Created new prompt cache with \(modelCache.count) KV layers for model: \(modelId)")
        return newCache
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
            log("[mlx] Error: generate() called but no model is loaded")
            throw MLXServerError.modelNotLoaded
        }

        log("[mlx] Generate: \(messages.count) messages, temp=\(temperature), topP=\(topP), maxTokens=\(maxTokens)")

        let chat = buildChat(from: messages)
        let toolSpecs = buildToolSpecs(from: tools)
        let generateParameters = buildGenerateParameters(
            temperature: temperature, topP: topP,
            maxTokens: maxTokens, repetitionPenalty: repetitionPenalty
        )

        let userInput = UserInput(
            chat: chat,
            processing: .init(resize: .init(width: 1024, height: 1024)),
            tools: toolSpecs
        )

        let result: (String, [ToolCallInfo], UsageInfo) = try await container.perform { context in
            let fullInput = try await context.processor.prepare(input: userInput)
            let fullTokens = fullInput.text.tokens
            let promptTokenCount = fullTokens.size

            // Get or create prompt cache
            let cache = await getPromptCache(context: context, parameters: generateParameters)

            // Determine if we can use cached prefix
            let lmInput: LMInput
            if let suffix = cache.getUncachedSuffix(prompt: fullTokens) {
                lmInput = LMInput(text: LMInput.Text(tokens: suffix))
                log("[mlx] Using cached prefix, processing \(suffix.size) new tokens")
            } else {
                lmInput = fullInput
                log("[mlx] Cache miss, processing all \(fullTokens.size) tokens")
            }

            var output = ""
            var completionTokenCount = 0
            var collectedToolCalls: [ToolCallInfo] = []
            var completionInfo: GenerateCompletionInfo?

            do {
                for await generation in try MLXLMCommon.generate(
                    input: lmInput, cache: cache.cache, parameters: generateParameters, context: context
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
                            log("[mlx] Hit stop sequence: \"\(s)\"")
                            break
                        }
                        if hitStop { break }

                    case .info(let info):
                        completionInfo = info
                        // Note: info.promptTokenCount is the tokens processed in this call (may be less due to caching)
                        // We report the full promptTokenCount in usage for accurate tracking
                        log("[mlx] Generation info: \(info.promptTokenCount) processed prompt tokens, \(info.generationTokenCount) generated tokens")
                        log("[mlx]   Prompt: \(String(format: "%.1f", info.promptTokensPerSecond)) tokens/sec")
                        log("[mlx]   Generation: \(String(format: "%.1f", info.tokensPerSecond)) tokens/sec")

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
            } catch {
                log("[mlx] Error during generation: \(error.localizedDescription)")
                throw error
            }

            let usage: UsageInfo
            if let info = completionInfo {
                // Use full prompt token count for accurate usage tracking (info.promptTokenCount may be smaller due to caching)
                usage = UsageInfo(
                    prompt_tokens: promptTokenCount,
                    completion_tokens: info.generationTokenCount,
                    total_tokens: promptTokenCount + info.generationTokenCount
                )
            } else {
                usage = UsageInfo(
                    prompt_tokens: promptTokenCount,
                    completion_tokens: completionTokenCount,
                    total_tokens: promptTokenCount + completionTokenCount
                )
            }

            log("[mlx] Generate complete: \(output.count) chars, \(collectedToolCalls.count) tool call(s)")
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
                    log("[mlx] Error: generateStream() called but no model is loaded")
                    continuation.finish(throwing: MLXServerError.modelNotLoaded)
                    return
                }

                log("[mlx] Stream generate: \(messages.count) messages, temp=\(temperature), topP=\(topP), maxTokens=\(maxTokens)")

                let chat = self.buildChat(from: messages)
                let toolSpecs = self.buildToolSpecs(from: tools)

                let userInput = UserInput(
                    chat: chat,
                    processing: .init(resize: .init(width: 1024, height: 1024)),
                    tools: toolSpecs
                )

                do {
                    try await container.perform { context in
                        let generateParameters = self.buildGenerateParameters(
                            temperature: temperature, topP: topP,
                            maxTokens: maxTokens, repetitionPenalty: repetitionPenalty
                        )

                        let fullInput = try await context.processor.prepare(input: userInput)
                        let fullTokens = fullInput.text.tokens

                        // Get or create prompt cache
                        let cache = await self.getPromptCache(context: context, parameters: generateParameters)

                        // Determine if we can use cached prefix
                        let lmInput: LMInput
                        if let suffix = cache.getUncachedSuffix(prompt: fullTokens) {
                            lmInput = LMInput(text: LMInput.Text(tokens: suffix))
                            log("[mlx] Stream using cached prefix, processing \(suffix.size) new tokens")
                        } else {
                            lmInput = fullInput
                            log("[mlx] Stream cache miss, processing all \(fullTokens.size) tokens")
                        }

                        var completionTokenCount = 0
                        var accumulated = ""
                        var hasToolCalls = false

                        do {
                            for await generation in try MLXLMCommon.generate(
                                input: lmInput, cache: cache.cache, parameters: generateParameters, context: context
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
                                        log("[mlx] Hit stop sequence: \"\(s)\"")
                                        break
                                    }
                                    if hitStop { break }

                                case .info(let info):
                                    log("[mlx] Stream generation info: \(info.promptTokenCount) processed prompt tokens, \(info.generationTokenCount) generated tokens")
                                    log("[mlx]   Prompt: \(String(format: "%.1f", info.promptTokensPerSecond)) tokens/sec")
                                    log("[mlx]   Generation: \(String(format: "%.1f", info.tokensPerSecond)) tokens/sec")

                                    // Use full prompt token count for accurate usage tracking
                                    let promptTokenCount = fullTokens.size
                                    let usage = UsageInfo(
                                        prompt_tokens: promptTokenCount,
                                        completion_tokens: info.generationTokenCount,
                                        total_tokens: promptTokenCount + info.generationTokenCount
                                    )
                                    let timings = TimingsInfo(
                                        prompt_n: promptTokenCount,
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
                        } catch {
                            log("[mlx] Error during stream generation: \(error.localizedDescription)")
                            throw error
                        }

                        // If no .info was received, send done with fallback usage
                        // The .info case already yields .done, so only send if we haven't
                        log("[mlx] Stream complete: \(accumulated.count) chars")
                        continuation.finish()
                    }
                } catch {
                    log("[mlx] Error in stream: \(error.localizedDescription)")
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
