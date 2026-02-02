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
    private var isVLM: Bool = false  // Track if model is VLM (has different cache structure)

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

        let warmUpMessages = [ChatMessage(role: "user", content: .string("Hello"))]
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

    /// Detect if model is a VLM from config.json
    enum ModelType {
        case llm
        case vlm
        case unknown
    }

    private func detectModelType(modelDir: URL) -> ModelType {
        let configURL = modelDir.appendingPathComponent("config.json")

        guard let configData = try? Data(contentsOf: configURL),
              let json = try? JSONSerialization.jsonObject(with: configData, options: []) as? [String: Any],
              let architectures = json["architectures"] as? [Any],
              let firstArch = architectures.first else {
            return .unknown
        }

        // Handle both String and [String: Any] architectures
        let firstArchString: String
        if let archString = firstArch as? String {
            firstArchString = archString
        } else if let archDict = firstArch as? [String: Any],
                  let archString = archDict["architectures"] as? String {
            firstArchString = archString
        } else {
            return .unknown
        }

        // Check if architecture indicates VLM (ends with VL or VLM)
        let upperArch = firstArchString.uppercased()
        if upperArch.contains("VL") || upperArch.contains("VLM") || upperArch.contains("VISION") {
            log("[mlx] Detected VLM model: \(firstArchString)")
            return .vlm
        }

        log("[mlx] Detected LLM model: \(firstArchString)")
        return .llm
    }

    /// Load a model from the given path
    /// Supports both local directories and HuggingFace model IDs
    func load(modelPath: String, modelId: String) async throws {
        log("[mlx] Loading model from: \(modelPath)")

        let modelConfiguration: ModelConfiguration
        var modelDir: URL?

        // Check if the path is a local directory or a HuggingFace model ID
        let modelURL = URL(fileURLWithPath: modelPath)
        let fileManager = FileManager.default

        // Check if path is a directory
        var isDirectory: ObjCBool = false
        let pathExists = fileManager.fileExists(atPath: modelPath, isDirectory: &isDirectory)

        if pathExists && isDirectory.boolValue {
            // Local model directory
            modelDir = modelURL
            let configURL = modelDir!.appendingPathComponent("config.json")
            if fileManager.fileExists(atPath: configURL.path) {
                modelConfiguration = ModelConfiguration(directory: modelDir!, defaultPrompt: "")
                log("[mlx] Using local model directory: \(modelDir!.path)")
            } else {
                // Try parent directory
                let parentDir = modelDir!.deletingLastPathComponent()
                let parentConfigURL = parentDir.appendingPathComponent("config.json")
                if fileManager.fileExists(atPath: parentConfigURL.path) {
                    modelDir = parentDir
                    modelConfiguration = ModelConfiguration(directory: parentDir, defaultPrompt: "")
                    log("[mlx] Using parent directory: \(parentDir.path)")
                } else {
                    modelConfiguration = ModelConfiguration(id: modelPath)
                    log("[mlx] Falling back to HuggingFace model ID: \(modelPath)")
                }
            }
        } else if pathExists {
            // Single file - use parent directory
            modelDir = modelURL.deletingLastPathComponent()
            modelConfiguration = ModelConfiguration(directory: modelDir!, defaultPrompt: "")
            log("[mlx] Using parent directory: \(modelDir!.path)")
        } else if modelPath.contains("/") && !modelPath.hasPrefix("/") {
            // HuggingFace model ID
            modelConfiguration = ModelConfiguration(id: modelPath)
            log("[mlx] Using HuggingFace model ID: \(modelPath)")
        } else {
            modelConfiguration = ModelConfiguration(id: modelPath)
            log("[mlx] Treating as HuggingFace model ID: \(modelPath)")
        }

        // Detect model type and select appropriate factory
        let modelType: ModelType
        if let dir = modelDir {
            modelType = detectModelType(modelDir: dir)
        } else {
            // For HuggingFace IDs, try VLM first for vision models, then LLM
            modelType = .unknown
        }

        // Load using the appropriate factory
        switch modelType {
        case .vlm:
            // Load as VLM directly
            log("[mlx] Loading as VLM model...")
            self.container = try await VLMModelFactory.shared.loadContainer(
                configuration: modelConfiguration
            ) { progress in
                log("[mlx] Loading progress: \(Int(progress.fractionCompleted * 100))%")
            }
            self.isVLM = true
            log("[mlx] Model loaded as VLM: \(modelId)")

        case .llm:
            // Load as LLM directly
            log("[mlx] Loading as LLM model...")
            self.container = try await LLMModelFactory.shared.loadContainer(
                configuration: modelConfiguration
            ) { progress in
                log("[mlx] Loading progress: \(Int(progress.fractionCompleted * 100))%")
            }
            log("[mlx] Model loaded as LLM: \(modelId)")

        case .unknown:
            // Try LLM first, fall back to VLM
            do {
                self.container = try await LLMModelFactory.shared.loadContainer(
                    configuration: modelConfiguration
                ) { progress in
                    log("[mlx] Loading progress: \(Int(progress.fractionCompleted * 100))%")
                }
                log("[mlx] Model loaded as LLM: \(modelId)")
            } catch {
                log("[mlx] LLM loading failed (\(error.localizedDescription)), trying VLM factory...")
                do {
                    self.container = try await VLMModelFactory.shared.loadContainer(
                        configuration: modelConfiguration
                    ) { progress in
                        log("[mlx] Loading progress: \(Int(progress.fractionCompleted * 100))%")
                    }
                    self.isVLM = true
                    log("[mlx] Model loaded as VLM: \(modelId)")
                } catch {
                    log("[mlx] Error: Failed to load model with both LLM and VLM factories: \(error.localizedDescription)")
                    throw error
                }
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
    /// Note: VLM models have different cache structure, so caching is skipped for them
    private func getPromptCache(context: ModelContext, parameters: GenerateParameters) -> PromptCache? {
        // VLM models have incompatible cache structure - skip prefix caching
        if isVLM {
            return nil
        }
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

            // Get or create prompt cache (nil for VLM models)
            let cache = await getPromptCache(context: context, parameters: generateParameters)

            // Determine if we can use cached prefix
            let lmInput: LMInput
            if let cache = cache, let suffix = cache.getUncachedSuffix(prompt: fullTokens) {
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
                    input: lmInput, cache: cache?.cache, parameters: generateParameters, context: context
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

                        // Get or create prompt cache (nil for VLM models)
                        let cache = await self.getPromptCache(context: context, parameters: generateParameters)

                        // Determine if we can use cached prefix
                        let lmInput: LMInput
                        if let cache = cache, let suffix = cache.getUncachedSuffix(prompt: fullTokens) {
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
                                input: lmInput, cache: cache?.cache, parameters: generateParameters, context: context
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

// MARK: - Batching Support

extension ModelRunner {
    /// Execute a batch of requests concurrently
    /// This is a simplified batch execution - for full batching, implement continuous batching
    func executeBatch(
        requests: [ChatCompletionRequest],
        config: BatchingConfig
    ) async throws -> [BatchResult] {
        guard let container = container else {
            throw MLXServerError.modelNotLoaded
        }

        log("[mlx] Batch execute: \(requests.count) requests")

        var results: [BatchResult] = []

        // Process all requests
        for chatRequest in requests {
            let startTime = Date()

            let (text, toolCalls, usage) = try await generate(
                messages: chatRequest.messages,
                temperature: chatRequest.temperature ?? 0.7,
                topP: chatRequest.top_p ?? 1.0,
                maxTokens: chatRequest.max_tokens ?? chatRequest.n_predict ?? 2048,
                repetitionPenalty: chatRequest.repetition_penalty ?? 1.0,
                stop: chatRequest.stop ?? [],
                tools: chatRequest.tools
            )

            let latencyMs = Date().timeIntervalSince(startTime) * 1000

            let result = BatchResult(
                requestId: chatRequest.model,  // Use model as request ID for now
                text: text,
                toolCalls: toolCalls,
                usage: usage,
                latencyMs: latencyMs
            )
            results.append(result)
        }

        return results
    }
}

enum MLXServerError: Error, LocalizedError {
    case modelNotLoaded
    case invalidRequest(String)
    case batchingNotEnabled
    case speculativeDecodingNotSupported

    var errorDescription: String? {
        switch self {
        case .modelNotLoaded:
            return "No model is currently loaded"
        case .invalidRequest(let msg):
            return "Invalid request: \(msg)"
        case .batchingNotEnabled:
            return "Batching is not enabled"
        case .speculativeDecodingNotSupported:
            return "Speculative decoding is not supported for this model"
        }
    }
}

// MARK: - Speculative Decoding Support

/// Configuration for speculative decoding
public struct SpeculativeConfig: Sendable {
    /// Number of draft tokens to generate
    public let numDraftTokens: Int

    /// Threshold for accepting draft tokens (0.0 - 1.0)
    public let acceptanceThreshold: Float

    /// Whether speculative decoding is enabled
    public let enabled: Bool

    public init(numDraftTokens: Int = 4, acceptanceThreshold: Float = 0.5, enabled: Bool = true) {
        self.numDraftTokens = numDraftTokens
        self.acceptanceThreshold = acceptanceThreshold
        self.enabled = enabled
    }
}

/// Result of speculative decoding
public struct SpeculativeResult: Sendable {
    /// The generated text
    public let text: String

    /// Number of draft tokens accepted
    public let acceptedDraftTokens: Int

    /// Total draft tokens generated
    public let totalDraftTokens: Int

    /// Acceptance rate
    public let acceptanceRate: Double

    /// Speedup achieved
    public let speedup: Double

    public init(
        text: String,
        acceptedDraftTokens: Int,
        totalDraftTokens: Int,
        acceptanceRate: Double,
        speedup: Double
    ) {
        self.text = text
        self.acceptedDraftTokens = acceptedDraftTokens
        self.totalDraftTokens = totalDraftTokens
        self.acceptanceRate = acceptanceRate
        self.speedup = speedup
    }
}

/// Manager for speculative decoding
actor SpeculativeGenerator {
    private var medusaHeads: MedusaHeads?
    private var config: SpeculativeConfig?

    /// Setup speculative decoding with configuration
    func setup(config: SpeculativeConfig) async throws {
        guard config.enabled else {
            self.config = nil
            return
        }

        // Check if model supports speculative decoding
        // This would require checking for Medusa heads or creating them
        self.config = config

        log("[mlx] Speculative decoding enabled with \(config.numDraftTokens) draft tokens")
    }

    /// Generate with speculative decoding
    func speculativeGenerate(
        input: LMInput,
        cache: [KVCache],
        parameters: GenerateParameters,
        context: ModelContext
    ) async throws -> AsyncThrowingStream<String, Error> {
        guard config != nil else {
            throw MLXServerError.speculativeDecodingNotSupported
        }

        // Fall back to regular generation if speculative not set up
        return AsyncThrowingStream { continuation in
            Task {
                do {
                    for try await generation in try MLXLMCommon.generate(
                        input: input,
                        cache: cache,
                        parameters: parameters,
                        context: context
                    ) {
                        switch generation {
                        case .chunk(let text):
                            continuation.yield(text)
                        case .info(_), .toolCall(_):
                            // Ignore info and tool calls for speculative generation
                            break
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    /// Get speculative decoding status
    func getStatus() -> SpeculativeStatus {
        SpeculativeStatus(
            enabled: config != nil,
            numDraftTokens: config?.numDraftTokens ?? 0,
            hasMedusaHeads: medusaHeads != nil
        )
    }
}

/// Medusa heads for speculative decoding
struct MedusaHeads {
    /// Number of prediction heads
    let numHeads: Int

    /// Hidden dimension size
    let hiddenSize: Int

    /// Head configurations
    let heads: [MedusaHead]

    /// Tree mask for parallel decoding paths
    let treeMask: MLXArray?

    /// Tree indices for selecting paths
    let treeIndices: MLXArray?
}

/// Configuration for a single Medusa head
struct MedusaHead {
    let index: Int
    let hiddenSize: Int
    let intermediateSize: Int
}

/// Status of speculative decoding
struct SpeculativeStatus {
    let enabled: Bool
    let numDraftTokens: Int
    let hasMedusaHeads: Bool
}

// MARK: - Paged Attention Support

/// Paged KV cache for memory-efficient attention computation
actor PagedKVCacheManager {
    private var blocks: [Int: KVBlock] = [:]
    private var freeBlocks: Set<Int> = []
    private var nextBlockId: Int = 0

    /// Block size in tokens
    let blockSize: Int

    /// Maximum number of blocks
    let maxBlocks: Int

    init(blockSize: Int = 16, maxBlocks: Int = 10000) {
        self.blockSize = blockSize
        self.maxBlocks = maxBlocks
    }

    /// Allocate blocks for n tokens
    func allocate(nTokens: Int) -> [Int] {
        let numBlocks = (nTokens + blockSize - 1) / blockSize
        var blockIds: [Int] = []

        for _ in 0..<numBlocks {
            let blockId: Int
            if let free = freeBlocks.popFirst() {
                blockId = free
            } else {
                blockId = nextBlockId
                nextBlockId += 1
            }
            blockIds.append(blockId)
        }
        return blockIds
    }

    /// Free blocks when sequence completes
    func free(blockIds: [Int]) {
        freeBlocks.formUnion(blockIds)
    }

    /// Get block statistics
    func getStats() -> PagedCacheStats {
        PagedCacheStats(
            totalBlocks: blocks.count,
            freeBlocks: freeBlocks.count,
            allocatedBlocks: blocks.count - freeBlocks.count,
            blockSize: blockSize,
            maxBlocks: maxBlocks
        )
    }
}

/// A block in the paged KV cache
struct KVBlock: Sendable {
    let blockId: Int
    var keys: MLXArray
    var values: MLXArray
}

/// Statistics for paged cache
struct PagedCacheStats {
    let totalBlocks: Int
    let freeBlocks: Int
    let allocatedBlocks: Int
    let blockSize: Int
    let maxBlocks: Int
}

// MARK: - Optimization Metrics

/// Track optimization metrics for the inference engine
struct OptimizationMetrics {
    var totalRequests: Int = 0
    var totalTokens: Int = 0
    var totalLatencyMs: Double = 0
    var cacheHits: Int = 0
    var cacheMisses: Int = 0
    var speculativeAccepted: Int = 0
    var speculativeTotal: Int = 0

    var avgLatencyMs: Double {
        totalRequests > 0 ? totalLatencyMs / Double(totalRequests) : 0
    }

    var tokensPerSecond: Double {
        totalLatencyMs > 0 ? Double(totalTokens) / (totalLatencyMs / 1000) : 0
    }

    var cacheHitRate: Double {
        let total = cacheHits + cacheMisses
        return total > 0 ? Double(cacheHits) / Double(total) : 0
    }

    var speculativeAcceptanceRate: Double {
        speculativeTotal > 0 ? Double(speculativeAccepted) / Double(speculativeTotal) : 0
    }

    mutating func recordRequest(tokens: Int, latencyMs: Double) {
        totalRequests += 1
        totalTokens += tokens
        totalLatencyMs += latencyMs
    }

    mutating func recordCacheHit() {
        cacheHits += 1
    }

    mutating func recordCacheMiss() {
        cacheMisses += 1
    }

    mutating func recordSpeculative(accepted: Int, total: Int) {
        speculativeAccepted += accepted
        speculativeTotal += total
    }
}
