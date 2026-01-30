import Foundation
import Hummingbird

/// HTTP server that exposes an OpenAI-compatible API backed by MLX
struct MLXHTTPServer {
    let modelRunner: ModelRunner
    let modelId: String
    let apiKey: String

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
            let body = try await request.body.collect(upTo: 10 * 1024 * 1024)  // 10MB max
            let chatRequest = try JSONDecoder().decode(ChatCompletionRequest.self, from: body)

            let temperature = chatRequest.temperature ?? 0.7
            let topP = chatRequest.top_p ?? 1.0
            let maxTokens = chatRequest.max_tokens ?? chatRequest.n_predict ?? 2048
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
        }

        return router
    }

    private func handleNonStreamingRequest(
        chatRequest: ChatCompletionRequest,
        temperature: Float,
        topP: Float,
        maxTokens: Int,
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
            content: text.isEmpty && !toolCalls.isEmpty ? nil : text,
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
        maxTokens: Int,
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

        // Build SSE response body
        let responseStream = AsyncStream<ByteBuffer> { continuation in
            Task {
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
                    log("[mlx] Error in SSE stream: \(error.localizedDescription)")
                    // Send error as SSE event
                    var buffer = ByteBufferAllocator().buffer(capacity: 256)
                    buffer.writeString(
                        "error: {\"message\":\"\(error.localizedDescription)\"}\n\n")
                    continuation.yield(buffer)
                }

                continuation.finish()
            }
        }

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
