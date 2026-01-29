import Foundation

// MARK: - Chat Completion Request

struct ChatCompletionRequest: Codable {
    let model: String
    let messages: [ChatMessage]
    var temperature: Float?
    var top_p: Float?
    var max_tokens: Int?
    var stream: Bool?
    var stop: [String]?
    var n_predict: Int?
    var repetition_penalty: Float?
    var tools: [AnyCodable]?
}

struct AnyCodable: Codable, @unchecked Sendable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        if let string = value as? String {
            try container.encode(string)
        } else if let int = value as? Int {
            try container.encode(int)
        } else if let double = value as? Double {
            try container.encode(double)
        } else if let bool = value as? Bool {
            try container.encode(bool)
        } else if let array = value as? [Any] {
            try container.encode(array.map { AnyCodable($0) })
        } else if let dict = value as? [String: Any] {
            try container.encode(dict.mapValues { AnyCodable($0) })
        } else {
            throw EncodingError.invalidValue(value, EncodingError.Context(codingPath: encoder.codingPath, debugDescription: "Unsupported type"))
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if let string = try? container.decode(String.self) {
            value = string
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues { $0.value }
        } else {
            throw DecodingError.dataCorrupted(DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Unsupported type"))
        }
    }

    /// Recursively convert the underlying value to `[String: any Sendable]` or primitive Sendable types
    func toSendable() -> any Sendable {
        switch value {
        case let string as String:
            return string
        case let int as Int:
            return int
        case let double as Double:
            return double
        case let bool as Bool:
            return bool
        case let array as [Any]:
            return array.map { AnyCodable($0).toSendable() }
        case let dict as [String: Any]:
            return dict.mapValues { AnyCodable($0).toSendable() }
        default:
            return String(describing: value)
        }
    }
}

struct ChatMessage: Codable {
    let role: String
    var content: String?
    var images: [String]?
    var videos: [String]?
    var tool_calls: [ToolCallInfo]?
    var tool_call_id: String?
    var name: String?
}

// MARK: - Tool Call Types (OpenAI-compatible)

struct ToolCallInfo: Codable {
    let id: String
    let type: String
    let function: FunctionCall
}

struct FunctionCall: Codable {
    let name: String
    let arguments: String
}

struct ToolCallDelta: Codable {
    let index: Int
    var id: String?
    var type: String?
    var function: FunctionCallDelta?
}

struct FunctionCallDelta: Codable {
    var name: String?
    var arguments: String?
}

// MARK: - Chat Completion Response (non-streaming)

struct ChatCompletionResponse: Codable {
    let id: String
    let object: String
    let created: Int
    let model: String
    let choices: [ChatChoice]
    var usage: UsageInfo?
}

struct ChatChoice: Codable {
    let index: Int
    let message: ChatMessage
    let finish_reason: String?
}

struct UsageInfo: Codable {
    let prompt_tokens: Int
    let completion_tokens: Int
    let total_tokens: Int
}

// MARK: - Chat Completion Chunk (streaming)

struct ChatCompletionChunk: Codable {
    let id: String
    let object: String
    let created: Int
    let model: String
    let choices: [ChatChunkChoice]
    var usage: UsageInfo?
    var timings: TimingsInfo?
}

struct ChatChunkChoice: Codable {
    let index: Int
    let delta: ChatDelta
    let finish_reason: String?
}

struct ChatDelta: Codable {
    var role: String?
    var content: String?
    var tool_calls: [ToolCallDelta]?
}

struct TimingsInfo: Codable {
    var prompt_n: Int?
    var predicted_n: Int?
    var predicted_per_second: Double?
    var prompt_per_second: Double?
}

// MARK: - Models List Response

struct ModelsResponse: Codable {
    let object: String
    let data: [ModelInfo]
}

struct ModelInfo: Codable {
    let id: String
    let object: String
    let created: Int
    let owned_by: String
}

// MARK: - Health Response

struct HealthResponse: Codable {
    let status: String
}

// MARK: - Error Response

struct ErrorResponse: Codable {
    let error: ErrorDetail
}

struct ErrorDetail: Codable {
    let message: String
    let type_name: String
    let code: String?

    enum CodingKeys: String, CodingKey {
        case message
        case type_name = "type"
        case code
    }
}

// MARK: - Helpers

func generateResponseId() -> String {
    "chatcmpl-\(UUID().uuidString.prefix(12))"
}

func generateToolCallId() -> String {
    "call_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(24))"
}

func currentTimestamp() -> Int {
    Int(Date().timeIntervalSince1970)
}
