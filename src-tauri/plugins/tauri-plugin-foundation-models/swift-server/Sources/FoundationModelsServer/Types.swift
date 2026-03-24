import Foundation

// MARK: - OpenAI Request Types

struct ChatCompletionRequest: Codable, Sendable {
    let model: String
    let messages: [ChatMessage]
    var temperature: Double?
    var top_p: Double?
    var max_tokens: Int?
    var n_predict: Int?
    var stream: Bool?
    var stop: [String]?
}

struct ChatMessage: Codable, Sendable {
    let role: String
    let content: String?
}

// MARK: - OpenAI Response Types

struct ChatCompletionResponse: Codable, Sendable {
    let id: String
    let object: String
    let created: Int
    let model: String
    let choices: [ChatCompletionChoice]
    let usage: UsageInfo
}

struct ChatCompletionChoice: Codable, Sendable {
    let index: Int
    let message: ChatResponseMessage
    let finish_reason: String
}

struct ChatResponseMessage: Codable, Sendable {
    let role: String
    let content: String
}

struct UsageInfo: Codable, Sendable {
    let prompt_tokens: Int
    let completion_tokens: Int
    let total_tokens: Int
}

// MARK: - Streaming Types

struct ChatCompletionChunk: Codable, Sendable {
    let id: String
    let object: String
    let created: Int
    let model: String
    let choices: [ChunkChoice]
}

struct ChunkChoice: Codable, Sendable {
    let index: Int
    let delta: DeltaContent
    let finish_reason: String?
}

struct DeltaContent: Codable, Sendable {
    let role: String?
    let content: String?
}

// MARK: - Model List Types

struct ModelsListResponse: Codable, Sendable {
    let object: String
    let data: [ModelData]
}

struct ModelData: Codable, Sendable {
    let id: String
    let object: String
    let created: Int
    let owned_by: String
}

// MARK: - Health / Error Types

struct HealthResponse: Codable, Sendable {
    let status: String
}

struct ErrorDetail: Codable, Sendable {
    let message: String
    let type: String
    let code: String?
}

struct ErrorResponse: Codable, Sendable {
    let error: ErrorDetail
}
