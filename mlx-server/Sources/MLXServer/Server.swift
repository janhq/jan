import Foundation
import Hummingbird

/// Tracks active generation tasks for external cancellation (e.g., /cancel endpoint)
actor ActiveGenerations {
    private var tasks: [String: Task<Void, Never>] = [:]

    func register(_ id: String, task: Task<Void, Never>) {
        tasks[id] = task
    }

    func cancel(_ id: String) -> Bool {
        guard let task = tasks.removeValue(forKey: id) else { return false }
        task.cancel()
        return true
    }

    func cancelAll() -> Int {
        let count = tasks.count
        tasks.values.forEach { $0.cancel() }
        tasks.removeAll()
        return count
    }

    func remove(_ id: String) {
        tasks.removeValue(forKey: id)
    }
}

/// HTTP server that exposes an OpenAI-compatible API backed by MLX
struct MLXHTTPServer {
    let modelRunner: ModelRunner
    let modelId: String
    let apiKey: String
    let activeGenerations = ActiveGenerations()

    init(modelRunner: ModelRunner, modelId: String, apiKey: String) {
        self.modelRunner = modelRunner
        self.modelId = modelId
        self.apiKey = apiKey
    }

    func buildRouter() -> Router<BasicRequestContext> {
        let router = Router()

        // Health check
        router.get("/health") { _, _ in
            let response = HealthResponse(status: "ok")
            return try encodeJSON(response)
        }

        // List models
        router.get("/v1/models") { _, _ in
            let response = ModelsResponse(
                object: "list",
                data: [
                    ModelInfo(
                        id: self.modelId,
                        object: "model",
                        created: currentTimestamp(),
                        owned_by: "mlx"
                    )
                ]
            )
            return try encodeJSON(response)
        }

        // Chat completions
        router.post("/v1/chat/completions") { request, context in
            // Validate API key if set
            if !self.apiKey.isEmpty {
                let authHeader =
                request.headers[.authorization]
                let expectedAuth = "Bearer \(self.apiKey)"
                if authHeader != expectedAuth {
                    let error = ErrorResponse(
                        error: ErrorDetail(
                            message: "Unauthorized",
                            type_name: "authentication_error",
                            code: "unauthorized"
                        )
                    )
                    let response = try Response(
                        status: .unauthorized,
                        headers: [.contentType: "application/json"],
                        body: .init(byteBuffer: encodeJSONBuffer(error))
                    )
                    return response
                }
            }

            // Parse request body
            do {
                let body = try await request.body.collect(upTo: 10 * 1024 * 1024)  // 10MB max
                let chatRequest = try JSONDecoder().decode(ChatCompletionRequest.self, from: body)

                let temperature = chatRequest.temperature ?? 0.7
                let topP = chatRequest.top_p ?? 1.0
                let maxTokens = chatRequest.max_tokens ?? chatRequest.n_predict
                let repetitionPenalty = chatRequest.repetition_penalty ?? 1.0
                let stop = chatRequest.stop ?? []
                let isStreaming = chatRequest.stream ?? false
                let tools = chatRequest.tools

                log("[mlx] Request: model=\(chatRequest.model), messages=\(chatRequest.messages.count), stream=\(isStreaming), tools=\(tools?.count ?? 0)")

                if isStreaming {
                    return try await self.handleStreamingRequest(
                        chatRequest: chatRequest,
                        temperature: temperature,
                        topP: topP,
                        maxTokens: maxTokens,
                        repetitionPenalty: repetitionPenalty,
                        stop: stop,
                        tools: tools
                    )
                } else {
                    return try await self.handleNonStreamingRequest(
                        chatRequest: chatRequest,
                        temperature: temperature,
                        topP: topP,
                        maxTokens: maxTokens,
                        repetitionPenalty: repetitionPenalty,
                        stop: stop,
                        tools: tools
                    )
                }
            } catch {
                log("[mlx] Error processing request: \(error.localizedDescription)")
                let errorResp = ErrorResponse(
                    error: ErrorDetail(
                        message: error.localizedDescription,
                        type_name: "invalid_request_error",
                        code: nil
                    )
                )
                return try Response(
                    status: .badRequest,
                    headers: [.contentType: "application/json"],
                    body: .init(byteBuffer: encodeJSONBuffer(errorResp))
                )
            }
        }

        // Anthropic Messages API
        router.post("/v1/messages") { request, context in
            // Validate API key if set
            if !self.apiKey.isEmpty {
                let authHeader = request.headers[.authorization]
                let expectedAuth = "Bearer \(self.apiKey)"
                if authHeader != expectedAuth {
                    let error = ErrorResponse(
                        error: ErrorDetail(
                            message: "Unauthorized",
                            type_name: "authentication_error",
                            code: "unauthorized"
                        )
                    )
                    return try Response(
                        status: .unauthorized,
                        headers: [.contentType: "application/json"],
                        body: .init(byteBuffer: encodeJSONBuffer(error))
                    )
                }
            }

            do {
                let body = try await request.body.collect(upTo: 10 * 1024 * 1024)
                let anthropicReq = try JSONDecoder().decode(AnthropicRequest.self, from: body)

                let messages = anthropicToInternalMessages(request: anthropicReq)
                let temperature = anthropicReq.temperature ?? 0.7
                let topP = anthropicReq.top_p ?? 1.0
                let maxTokens = anthropicReq.max_tokens
                let stop = anthropicReq.stop_sequences ?? []
                let isStreaming = anthropicReq.stream ?? false
                let tools: [AnyCodable]? = anthropicReq.tools.map { anthropicToolsToOpenAI($0) }

                log("[mlx] Anthropic request: model=\(anthropicReq.model), messages=\(messages.count), stream=\(isStreaming), tools=\(tools?.count ?? 0)")

                if isStreaming {
                    return try await self.handleAnthropicStreaming(
                        anthropicReq: anthropicReq,
                        messages: messages,
                        temperature: temperature,
                        topP: topP,
                        maxTokens: maxTokens,
                        stop: stop,
                        tools: tools
                    )
                } else {
                    return try await self.handleAnthropicNonStreaming(
                        anthropicReq: anthropicReq,
                        messages: messages,
                        temperature: temperature,
                        topP: topP,
                        maxTokens: maxTokens,
                        stop: stop,
                        tools: tools
                    )
                }
            } catch {
                log("[mlx] Error processing Anthropic request: \(error.localizedDescription)")
                let errorResp = ErrorResponse(
                    error: ErrorDetail(
                        message: error.localizedDescription,
                        type_name: "invalid_request_error",
                        code: nil
                    )
                )
                return try Response(
                    status: .badRequest,
                    headers: [.contentType: "application/json"],
                    body: .init(byteBuffer: encodeJSONBuffer(errorResp))
                )
            }
        }

        // Cancel active generation
        router.post("/v1/cancel") { _, _ in
            let cancelled = await self.activeGenerations.cancelAll()
            log("[mlx] Cancel requested: \(cancelled) active generation(s) cancelled")

            let response: [String: Any] = [
                "status": cancelled > 0 ? "cancelled" : "no_active_generation",
                "cancelled_count": cancelled,
            ]

            var jsonString = "{"
            jsonString += "\"status\":\"\(response["status"]!)\","
            jsonString += "\"cancelled_count\":\(response["cancelled_count"]!)"
            jsonString += "}"

            var buffer = ByteBufferAllocator().buffer(capacity: jsonString.count)
            buffer.writeString(jsonString)

            return Response(
                status: .ok,
                headers: [.contentType: "application/json"],
                body: .init(byteBuffer: buffer)
            )
        }

        return router
    }

    private func handleNonStreamingRequest(
        chatRequest: ChatCompletionRequest,
        temperature: Float,
        topP: Float,
        maxTokens: Int? = nil,
        repetitionPenalty: Float,
        stop: [String],
        tools: [AnyCodable]? = nil
    ) async throws -> Response {
        let (text, toolCalls, usage) = try await modelRunner.generate(
            messages: chatRequest.messages,
            temperature: temperature,
            topP: topP,
            maxTokens: maxTokens,
            repetitionPenalty: repetitionPenalty,
            stop: stop,
            tools: tools
        )

        let finishReason = toolCalls.isEmpty ? "stop" : "tool_calls"
        let message = ChatMessage(
            role: "assistant",
            content: .string(text.isEmpty && !toolCalls.isEmpty ? "" : text),
            tool_calls: toolCalls.isEmpty ? nil : toolCalls
        )

        let response = ChatCompletionResponse(
            id: generateResponseId(),
            object: "chat.completion",
            created: currentTimestamp(),
            model: chatRequest.model,
            choices: [
                ChatChoice(
                    index: 0,
                    message: message,
                    finish_reason: finishReason
                )
            ],
            usage: usage
        )

        log("[mlx] Response: \(text.count) chars, \(toolCalls.count) tool call(s), finish=\(finishReason)")

        return try Response(
            status: .ok,
            headers: [.contentType: "application/json"],
            body: .init(byteBuffer: encodeJSONBuffer(response))
        )
    }

    private func handleStreamingRequest(
        chatRequest: ChatCompletionRequest,
        temperature: Float,
        topP: Float,
        maxTokens: Int?,
        repetitionPenalty: Float,
        stop: [String],
        tools: [AnyCodable]? = nil
    ) async throws -> Response {
        let responseId = generateResponseId()
        let created = currentTimestamp()
        let model = chatRequest.model

        let stream = await modelRunner.generateStream(
            messages: chatRequest.messages,
            temperature: temperature,
            topP: topP,
            maxTokens: maxTokens,
            repetitionPenalty: repetitionPenalty,
            stop: stop,
            tools: tools
        )

        // Use makeStream so we can create the task externally and register it for cancellation
        let (responseStream, continuation) = AsyncStream<ByteBuffer>.makeStream()
        let activeGenerations = self.activeGenerations

        let task = Task {
            defer {
                continuation.finish()
                Task { await activeGenerations.remove(responseId) }
            }

            // Send initial role chunk
            let initialChunk = ChatCompletionChunk(
                id: responseId,
                object: "chat.completion.chunk",
                created: created,
                model: model,
                choices: [
                    ChatChunkChoice(
                        index: 0,
                        delta: ChatDelta(role: "assistant", content: nil),
                        finish_reason: nil
                    )
                ]
            )
            if let data = try? encodeJSONData(initialChunk) {
                continuation.yield(buildSSEFrame(data))
            } else {
                log("[mlx] Warning: Failed to encode initial chunk")
            }

            do {
                for try await event in stream {
                    // Stop sending if client disconnected or cancelled
                    if Task.isCancelled {
                        log("[mlx] SSE stream cancelled by client")
                        break
                    }

                    switch event {
                    case .chunk(let token):
                        let chunk = ChatCompletionChunk(
                            id: responseId,
                            object: "chat.completion.chunk",
                            created: created,
                            model: model,
                            choices: [
                                ChatChunkChoice(
                                    index: 0,
                                    delta: ChatDelta(role: nil, content: token),
                                    finish_reason: nil
                                )
                            ]
                        )
                        if let data = try? encodeJSONData(chunk) {
                            continuation.yield(buildSSEFrame(data))
                        }

                    case .toolCall(let toolCallInfo):
                        let chunk = ChatCompletionChunk(
                            id: responseId,
                            object: "chat.completion.chunk",
                            created: created,
                            model: model,
                            choices: [
                                ChatChunkChoice(
                                    index: 0,
                                    delta: ChatDelta(
                                        role: nil,
                                        content: nil,
                                        tool_calls: [
                                            ToolCallDelta(
                                                index: 0,
                                                id: toolCallInfo.id,
                                                type: toolCallInfo.type,
                                                function: FunctionCallDelta(
                                                    name: toolCallInfo.function.name,
                                                    arguments: toolCallInfo.function.arguments
                                                )
                                            )
                                        ]
                                    ),
                                    finish_reason: nil
                                )
                            ]
                        )
                        if let data = try? encodeJSONData(chunk) {
                            continuation.yield(buildSSEFrame(data))
                        }

                    case .done(let usage, let timings, let hasToolCalls):

                        let finishReason = hasToolCalls ? "tool_calls" : "stop"
                        // Final chunk with finish_reason
                        let finalChunk = ChatCompletionChunk(
                            id: responseId,
                            object: "chat.completion.chunk",
                            created: created,
                            model: model,
                            choices: [
                                ChatChunkChoice(
                                    index: 0,
                                    delta: ChatDelta(role: nil, content: nil),
                                    finish_reason: finishReason
                                )
                            ],
                            usage: usage,
                            timings: timings
                        )
                        if let data = try? encodeJSONData(finalChunk) {
                            continuation.yield(buildSSEFrame(data))
                        }

                        // Send [DONE]
                        var doneBuffer = ByteBufferAllocator().buffer(capacity: 16)
                        doneBuffer.writeString("data: [DONE]\n\n")
                        continuation.yield(doneBuffer)
                    }
                }
            } catch {
                if !Task.isCancelled {
                    log("[mlx] Error in SSE stream: \(error.localizedDescription)")
                    // Send error as SSE event
                    var buffer = ByteBufferAllocator().buffer(capacity: 256)
                    buffer.writeString(
                        "error: {\"message\":\"\(error.localizedDescription)\"}\n\n")
                    continuation.yield(buffer)
                } else {
                    log("[mlx] SSE stream cancelled by client")
                }
            }
        }

        // Cancel the generation task when the stream consumer stops (client disconnect)
        continuation.onTermination = { @Sendable _ in
            log("[mlx] SSE continuation terminated, cancelling task")
            task.cancel()
        }

        // Register for external cancellation via /cancel endpoint
        await activeGenerations.register(responseId, task: task)

        return Response(
            status: .ok,
            headers: [
                .contentType: "text/event-stream",
                .init("Cache-Control")!: "no-cache",
                .init("Connection")!: "keep-alive",
            ],
            body: .init(asyncSequence: responseStream)
        )
    }

    // MARK: - Anthropic Non-Streaming Handler

    private func handleAnthropicNonStreaming(
        anthropicReq: AnthropicRequest,
        messages: [ChatMessage],
        temperature: Float,
        topP: Float,
        maxTokens: Int,
        stop: [String],
        tools: [AnyCodable]?
    ) async throws -> Response {
        let (text, toolCalls, usage) = try await modelRunner.generate(
            messages: messages,
            temperature: temperature,
            topP: topP,
            maxTokens: maxTokens,
            repetitionPenalty: 1.0,
            stop: stop,
            tools: tools
        )

        var content: [AnthropicResponseBlock] = []
        if !text.isEmpty {
            content.append(.text(AnthropicTextContent(type: "text", text: text)))
        }
        for tc in toolCalls {
            let inputDict = (try? JSONSerialization.jsonObject(with: Data(tc.function.arguments.utf8))) ?? [String: Any]()
            content.append(.toolUse(AnthropicToolUseContent(
                type: "tool_use",
                id: tc.id,
                name: tc.function.name,
                input: AnyCodable(inputDict)
            )))
        }
        if content.isEmpty {
            content.append(.text(AnthropicTextContent(type: "text", text: "")))
        }

        let stopReason = toolCalls.isEmpty ? "end_turn" : "tool_use"
        let response = AnthropicResponse(
            id: "msg-\(generateResponseId())",
            type: "message",
            role: "assistant",
            content: content,
            model: anthropicReq.model,
            stop_reason: stopReason,
            stop_sequence: nil,
            usage: AnthropicUsage(
                input_tokens: usage.prompt_tokens ?? 0,
                output_tokens: usage.completion_tokens
            )
        )

        log("[mlx] Anthropic response: \(text.count) chars, \(toolCalls.count) tool call(s), stop=\(stopReason)")

        let data = try anthropicEncoder.encode(response)
        var buffer = ByteBufferAllocator().buffer(capacity: data.count)
        buffer.writeBytes(data)
        return Response(
            status: .ok,
            headers: [.contentType: "application/json"],
            body: .init(byteBuffer: buffer)
        )
    }

    // MARK: - Anthropic Streaming Handler

    private func handleAnthropicStreaming(
        anthropicReq: AnthropicRequest,
        messages: [ChatMessage],
        temperature: Float,
        topP: Float,
        maxTokens: Int,
        stop: [String],
        tools: [AnyCodable]?
    ) async throws -> Response {
        let responseId = "msg-\(generateResponseId())"
        let model = anthropicReq.model

        let stream = await modelRunner.generateStream(
            messages: messages,
            temperature: temperature,
            topP: topP,
            maxTokens: maxTokens,
            repetitionPenalty: 1.0,
            stop: stop,
            tools: tools
        )

        let (responseStream, continuation) = AsyncStream<ByteBuffer>.makeStream()
        let activeGenerations = self.activeGenerations

        let task = Task {
            defer {
                continuation.finish()
                Task { await activeGenerations.remove(responseId) }
            }

            // message_start
            let startEvent = AnthropicMessageStartEvent(
                type: "message_start",
                message: AnthropicStreamMessage(
                    id: responseId,
                    type: "message",
                    role: "assistant",
                    content: [],
                    model: model,
                    stop_reason: nil,
                    stop_sequence: nil,
                    usage: AnthropicUsage(input_tokens: 0, output_tokens: 0)
                )
            )
            if let data = try? anthropicEncoder.encode(startEvent) {
                continuation.yield(buildAnthropicSSEFrame(event: "message_start", data: data))
            }

            // ping
            let ping = AnthropicPingEvent(type: "ping")
            if let data = try? anthropicEncoder.encode(ping) {
                continuation.yield(buildAnthropicSSEFrame(event: "ping", data: data))
            }

            // Open the initial text content block
            let textBlockStart = AnthropicContentBlockStartEvent(
                type: "content_block_start",
                index: 0,
                content_block: AnyCodable(["type": "text", "text": ""] as [String: Any])
            )
            if let data = try? anthropicEncoder.encode(textBlockStart) {
                continuation.yield(buildAnthropicSSEFrame(event: "content_block_start", data: data))
            }

            var blockIndex = 1      // next available block index (0 is the text block)
            var textBlockOpen = true
            var outputTokens = 0

            do {
                for try await event in stream {
                    if Task.isCancelled { break }

                    switch event {
                    case .chunk(let token):
                        outputTokens += 1
                        let delta = AnthropicContentBlockDeltaEvent(
                            type: "content_block_delta",
                            index: 0,
                            delta: AnyCodable(["type": "text_delta", "text": token] as [String: Any])
                        )
                        if let data = try? anthropicEncoder.encode(delta) {
                            continuation.yield(buildAnthropicSSEFrame(event: "content_block_delta", data: data))
                        }

                    case .toolCall(let tc):
                        // Close the text block on first tool call
                        if textBlockOpen {
                            let stop = AnthropicContentBlockStopEvent(type: "content_block_stop", index: 0)
                            if let data = try? anthropicEncoder.encode(stop) {
                                continuation.yield(buildAnthropicSSEFrame(event: "content_block_stop", data: data))
                            }
                            textBlockOpen = false
                        }

                        // Open a tool_use block
                        let toolStart = AnthropicContentBlockStartEvent(
                            type: "content_block_start",
                            index: blockIndex,
                            content_block: AnyCodable([
                                "type": "tool_use",
                                "id": tc.id,
                                "name": tc.function.name,
                            ] as [String: Any])
                        )
                        if let data = try? anthropicEncoder.encode(toolStart) {
                            continuation.yield(buildAnthropicSSEFrame(event: "content_block_start", data: data))
                        }

                        // Send the full arguments as a single input_json_delta
                        let toolDelta = AnthropicContentBlockDeltaEvent(
                            type: "content_block_delta",
                            index: blockIndex,
                            delta: AnyCodable([
                                "type": "input_json_delta",
                                "partial_json": tc.function.arguments,
                            ] as [String: Any])
                        )
                        if let data = try? anthropicEncoder.encode(toolDelta) {
                            continuation.yield(buildAnthropicSSEFrame(event: "content_block_delta", data: data))
                        }

                        // Close the tool_use block
                        let toolStop = AnthropicContentBlockStopEvent(
                            type: "content_block_stop", index: blockIndex)
                        if let data = try? anthropicEncoder.encode(toolStop) {
                            continuation.yield(buildAnthropicSSEFrame(event: "content_block_stop", data: data))
                        }

                        blockIndex += 1

                    case .done(let usage, _, let hasToolCalls):
                        // Close the text block if still open
                        if textBlockOpen {
                            let stop = AnthropicContentBlockStopEvent(type: "content_block_stop", index: 0)
                            if let data = try? anthropicEncoder.encode(stop) {
                                continuation.yield(buildAnthropicSSEFrame(event: "content_block_stop", data: data))
                            }
                        }

                        let stopReason = hasToolCalls ? "tool_use" : "end_turn"
                        let msgDelta = AnthropicMessageDeltaEvent(
                            type: "message_delta",
                            delta: AnthropicMessageDeltaPayload(
                                stop_reason: stopReason, stop_sequence: nil),
                            usage: AnthropicStreamUsage(
                                output_tokens: usage.completion_tokens)
                        )
                        if let data = try? anthropicEncoder.encode(msgDelta) {
                            continuation.yield(buildAnthropicSSEFrame(event: "message_delta", data: data))
                        }

                        let msgStop = AnthropicMessageStopEvent(type: "message_stop")
                        if let data = try? anthropicEncoder.encode(msgStop) {
                            continuation.yield(buildAnthropicSSEFrame(event: "message_stop", data: data))
                        }
                    }
                }
            } catch {
                if !Task.isCancelled {
                    log("[mlx] Error in Anthropic SSE stream: \(error.localizedDescription)")
                    var buffer = ByteBufferAllocator().buffer(capacity: 256)
                    buffer.writeString(
                        "error: {\"message\":\"\(error.localizedDescription)\"}\n\n")
                    continuation.yield(buffer)
                }
            }
        }

        continuation.onTermination = { @Sendable _ in
            log("[mlx] Anthropic SSE continuation terminated, cancelling task")
            task.cancel()
        }

        await activeGenerations.register(responseId, task: task)

        return Response(
            status: .ok,
            headers: [
                .contentType: "text/event-stream",
                .init("Cache-Control")!: "no-cache",
                .init("Connection")!: "keep-alive",
            ],
            body: .init(asyncSequence: responseStream)
        )
    }
}

// MARK: - JSON Encoding Helpers

/// Shared JSON encoder for consistent encoding and better performance
private let jsonEncoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .secondsSince1970
    encoder.keyEncodingStrategy = .convertToSnakeCase
    return encoder
}()

/// Encoder for Anthropic API responses — no key-encoding strategy so that
/// AnyCodable dict keys (e.g. tool input schemas) are preserved as-is.
private let anthropicEncoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .secondsSince1970
    return encoder
}()

/// Builds an Anthropic SSE frame: "event: <name>\ndata: <json>\n\n"
private func buildAnthropicSSEFrame(event: String, data: Data) -> ByteBuffer {
    let prefix = "event: \(event)\ndata: "
    var buffer = sseBufferAllocator.buffer(capacity: prefix.count + data.count + 2)
    buffer.writeString(prefix)
    buffer.writeBytes(data)
    buffer.writeString("\n\n")
    return buffer
}

private func encodeJSON<T: Encodable>(_ value: T) throws -> Response {
    let data = try jsonEncoder.encode(value)
    var buffer = ByteBufferAllocator().buffer(capacity: data.count)
    buffer.writeBytes(data)
    return Response(
        status: .ok,
        headers: [.contentType: "application/json"],
        body: .init(byteBuffer: buffer)
    )
}

private func encodeJSONBuffer<T: Encodable>(_ value: T) throws -> ByteBuffer {
    let data = try jsonEncoder.encode(value)
    var buffer = ByteBufferAllocator().buffer(capacity: data.count)
    buffer.writeBytes(data)
    return buffer
}

private func encodeJSONData<T: Encodable>(_ value: T) throws -> Data {
    try jsonEncoder.encode(value)
}

/// Reusable buffer allocator for SSE responses to reduce allocations
private let sseBufferAllocator = ByteBufferAllocator()

/// Builds an SSE data frame with the given JSON data
private func buildSSEFrame(_ data: Data) -> ByteBuffer {
    var buffer = sseBufferAllocator.buffer(capacity: data.count + 8)
    buffer.writeString("data: ")
    buffer.writeBytes(data)
    buffer.writeString("\n\n")
    return buffer
}
