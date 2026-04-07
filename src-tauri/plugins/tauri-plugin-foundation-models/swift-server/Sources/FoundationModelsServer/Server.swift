import Foundation
import Hummingbird
import FoundationModels

/// HTTP server exposing an OpenAI-compatible API backed by Apple Foundation Models
struct FoundationModelsHTTPServer: Sendable {
    let modelId: String
    let apiKey: String

    func buildRouter() -> Router<BasicRequestContext> {
        let router = Router()

        // Health check
        router.get("/health") { _, _ in
            let response = HealthResponse(status: "ok")
            return try encodeJSONResponse(response)
        }

        // List available models
        router.get("/v1/models") { _, _ in
            let response = ModelsListResponse(
                object: "list",
                data: [
                    ModelData(
                        id: self.modelId,
                        object: "model",
                        created: currentTimestamp(),
                        owned_by: "apple"
                    )
                ]
            )
            return try encodeJSONResponse(response)
        }

        // Chat completions (OpenAI-compatible)
        router.post("/v1/chat/completions") { request, _ in
            // Validate API key when configured
            if !self.apiKey.isEmpty {
                let authHeader = request.headers[.authorization]
                guard authHeader == "Bearer \(self.apiKey)" else {
                    let errorResp = ErrorResponse(
                        error: ErrorDetail(
                            message: "Unauthorized: invalid or missing API key",
                            type: "authentication_error",
                            code: "unauthorized"
                        )
                    )
                    return try Response(
                        status: .unauthorized,
                        headers: [.contentType: "application/json"],
                        body: .init(byteBuffer: encodeJSONBuffer(errorResp))
                    )
                }
            }

            let body = try await request.body.collect(upTo: 10 * 1024 * 1024)
            let chatRequest: ChatCompletionRequest
            do {
                chatRequest = try JSONDecoder().decode(ChatCompletionRequest.self, from: body)
            } catch {
                let errorResp = ErrorResponse(
                    error: ErrorDetail(
                        message: "Invalid request body: \(error.localizedDescription)",
                        type: "invalid_request_error",
                        code: nil
                    )
                )
                return try Response(
                    status: .badRequest,
                    headers: [.contentType: "application/json"],
                    body: .init(byteBuffer: encodeJSONBuffer(errorResp))
                )
            }
            let isStreaming = chatRequest.stream ?? false

            log("[foundation-models] Request: messages=\(chatRequest.messages.count), stream=\(isStreaming)")

            if isStreaming {
                return try await self.handleStreamingRequest(chatRequest)
            } else {
                return try await self.handleNonStreamingRequest(chatRequest)
            }
        }

        return router
    }

    // MARK: - Non-streaming

    private func handleNonStreamingRequest(_ chatRequest: ChatCompletionRequest) async throws -> Response {
        let session = buildSession(from: chatRequest.messages)
        let lastUserMessage = extractLastUserMessage(from: chatRequest.messages)

        let response = try await session.respond(to: lastUserMessage)
        let content = response.content

        let completionResponse = ChatCompletionResponse(
            id: "chatcmpl-\(UUID().uuidString)",
            object: "chat.completion",
            created: currentTimestamp(),
            model: modelId,
            choices: [
                ChatCompletionChoice(
                    index: 0,
                    message: ChatResponseMessage(role: "assistant", content: content),
                    finish_reason: "stop"
                )
            ],
            usage: UsageInfo(
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            )
        )

        return try encodeJSONResponse(completionResponse)
    }

    // MARK: - Streaming

    private func handleStreamingRequest(_ chatRequest: ChatCompletionRequest) async throws -> Response {
        let requestId = "chatcmpl-\(UUID().uuidString)"
        let created = currentTimestamp()
        let modelId = self.modelId
        let messages = chatRequest.messages

        let (stream, continuation) = AsyncStream<ByteBuffer>.makeStream()

        let task = Task { [self] in
            do {
                let session = self.buildSession(from: messages)
                let lastUserMessage = self.extractLastUserMessage(from: messages)

                let roleDelta = ChatCompletionChunk(
                    id: requestId,
                    object: "chat.completion.chunk",
                    created: created,
                    model: modelId,
                    choices: [
                        ChunkChoice(
                            index: 0,
                            delta: DeltaContent(role: "assistant", content: nil),
                            finish_reason: nil
                        )
                    ]
                )
                if let buffer = encodeSSEBuffer(roleDelta) {
                    continuation.yield(buffer)
                }

                var previousText = ""
                for try await snapshot in session.streamResponse(to: lastUserMessage) {
                    let currentText = snapshot.content
                    let delta = String(currentText.dropFirst(previousText.count))
                    previousText = currentText

                    if delta.isEmpty { continue }

                    let chunk = ChatCompletionChunk(
                        id: requestId,
                        object: "chat.completion.chunk",
                        created: created,
                        model: modelId,
                        choices: [
                            ChunkChoice(
                                index: 0,
                                delta: DeltaContent(role: nil, content: delta),
                                finish_reason: nil
                            )
                        ]
                    )
                    if let buffer = encodeSSEBuffer(chunk) {
                        continuation.yield(buffer)
                    }
                }

                // Send stop chunk
                let stopChunk = ChatCompletionChunk(
                    id: requestId,
                    object: "chat.completion.chunk",
                    created: created,
                    model: modelId,
                    choices: [
                        ChunkChoice(
                            index: 0,
                            delta: DeltaContent(role: nil, content: nil),
                            finish_reason: "stop"
                        )
                    ]
                )
                if let buffer = encodeSSEBuffer(stopChunk) {
                    continuation.yield(buffer)
                }

                // SSE terminator
                var doneBuffer = ByteBufferAllocator().buffer(capacity: 16)
                doneBuffer.writeString("data: [DONE]\n\n")
                continuation.yield(doneBuffer)
            } catch {
                log("[foundation-models] Streaming error: \(error.localizedDescription)")
                var errBuffer = ByteBufferAllocator().buffer(capacity: 256)
                errBuffer.writeString("error: {\"message\":\"\(error.localizedDescription)\"}\n\n")
                continuation.yield(errBuffer)
            }
            continuation.finish()
        }

        // Cancel the generation task when the client disconnects
        continuation.onTermination = { @Sendable _ in
            log("[foundation-models] SSE continuation terminated by client disconnect")
            task.cancel()
        }

        return Response(
            status: .ok,
            headers: [
                .contentType: "text/event-stream",
                .cacheControl: "no-cache",
                .init("X-Accel-Buffering")!: "no"
            ],
            body: .init(asyncSequence: stream)
        )
    }

    // MARK: - Session Construction

    /// Build a `LanguageModelSession` from the OpenAI message list.
    ///
    /// System messages become the session instructions.
    /// Prior user/assistant turns are serialised into the instructions block so
    /// the model has full conversation context without re-running inference.
    /// (The Foundation Models `Transcript` API is not used for history injection
    /// because it is designed for observing an already-live session's state, not
    /// for priming a fresh one with arbitrary history.)
    private func buildSession(from messages: [ChatMessage]) -> LanguageModelSession {
        let systemContent = messages.first(where: { $0.role == "system" })?.content ?? ""
        let nonSystem = messages.filter { $0.role != "system" }
        let history = nonSystem.dropLast()  // all turns except the last user message

        var instructionsText: String
        if systemContent.isEmpty {
            instructionsText = "You are a helpful assistant."
        } else {
            instructionsText = systemContent
        }

        // Append prior turns so the model understands conversation context
        if !history.isEmpty {
            instructionsText += "\n\n[Previous conversation]\n"
            for msg in history {
                let label = msg.role == "assistant" ? "Assistant" : "User"
                instructionsText += "\(label): \(msg.content ?? "")\n"
            }
            instructionsText += "[End of previous conversation]"
        }

        return LanguageModelSession(instructions: instructionsText)
    }

    private func extractLastUserMessage(from messages: [ChatMessage]) -> String {
        let nonSystem = messages.filter { $0.role != "system" }
        return nonSystem.last?.content ?? ""
    }
}

// MARK: - Helpers

private func currentTimestamp() -> Int {
    Int(Date().timeIntervalSince1970)
}

private func encodeJSONResponse<T: Encodable>(_ value: T) throws -> Response {
    let data = try JSONEncoder().encode(value)
    var buffer = ByteBufferAllocator().buffer(capacity: data.count)
    buffer.writeBytes(data)
    return Response(
        status: .ok,
        headers: [.contentType: "application/json"],
        body: .init(byteBuffer: buffer)
    )
}

private func encodeJSONBuffer<T: Encodable>(_ value: T) -> ByteBuffer {
    let data = (try? JSONEncoder().encode(value)) ?? Data()
    var buffer = ByteBufferAllocator().buffer(capacity: data.count)
    buffer.writeBytes(data)
    return buffer
}

private func encodeSSEBuffer<T: Encodable>(_ value: T) -> ByteBuffer? {
    guard let json = try? JSONEncoder().encode(value),
          let jsonString = String(data: json, encoding: .utf8) else {
        return nil
    }
    let line = "data: \(jsonString)\n\n"
    var buffer = ByteBufferAllocator().buffer(capacity: line.utf8.count)
    buffer.writeString(line)
    return buffer
}
