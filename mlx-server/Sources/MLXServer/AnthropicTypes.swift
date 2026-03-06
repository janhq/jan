import Foundation

// MARK: - Anthropic API Request

struct AnthropicRequest: Codable {
    let model: String
    let messages: [AnthropicMessage]
    let max_tokens: Int
    var system: AnthropicSystem?
    var temperature: Float?
    var top_p: Float?
    var top_k: Int?
    var stream: Bool?
    var stop_sequences: [String]?
    var tools: [AnyCodable]?
}

// MARK: - System Prompt (string or array of text blocks)

enum AnthropicSystem: Codable {
    case text(String)
    case blocks([AnthropicTextBlock])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { self = .text(s); return }
        if let b = try? c.decode([AnthropicTextBlock].self) { self = .blocks(b); return }
        throw DecodingError.dataCorrupted(
            .init(codingPath: decoder.codingPath, debugDescription: "system must be string or array"))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .text(let s): try c.encode(s)
        case .blocks(let b): try c.encode(b)
        }
    }

    var text: String {
        switch self {
        case .text(let s): return s
        case .blocks(let b): return b.map(\.text).joined(separator: "\n")
        }
    }
}

struct AnthropicTextBlock: Codable {
    let type: String
    let text: String
}

// MARK: - Messages

struct AnthropicMessage: Codable {
    let role: String
    let content: AnthropicMessageContent
}

enum AnthropicMessageContent: Codable {
    case text(String)
    case blocks([AnthropicContentBlock])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { self = .text(s); return }
        if let b = try? c.decode([AnthropicContentBlock].self) { self = .blocks(b); return }
        throw DecodingError.dataCorrupted(
            .init(codingPath: decoder.codingPath, debugDescription: "content must be string or array"))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .text(let s): try c.encode(s)
        case .blocks(let b): try c.encode(b)
        }
    }
}

// MARK: - Content Blocks

enum AnthropicContentBlock: Codable {
    case text(AnthropicTextContent)
    case image(AnthropicImageContent)
    case toolUse(AnthropicToolUseContent)
    case toolResult(AnthropicToolResultContent)
    case unknown

    private enum TypeKey: String, CodingKey { case type }

    init(from decoder: Decoder) throws {
        let kc = try decoder.container(keyedBy: TypeKey.self)
        let type = try kc.decode(String.self, forKey: .type)
        switch type {
        case "text":        self = .text(try AnthropicTextContent(from: decoder))
        case "image":       self = .image(try AnthropicImageContent(from: decoder))
        case "tool_use":    self = .toolUse(try AnthropicToolUseContent(from: decoder))
        case "tool_result": self = .toolResult(try AnthropicToolResultContent(from: decoder))
        default:            self = .unknown
        }
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .text(let b):       try b.encode(to: encoder)
        case .image(let b):      try b.encode(to: encoder)
        case .toolUse(let b):    try b.encode(to: encoder)
        case .toolResult(let b): try b.encode(to: encoder)
        case .unknown:           break
        }
    }
}

struct AnthropicTextContent: Codable {
    let type: String
    let text: String
}

struct AnthropicImageContent: Codable {
    let type: String
    let source: AnthropicImageSource
}

struct AnthropicImageSource: Codable {
    let type: String        // "base64" | "url"
    let media_type: String?
    let data: String?
    let url: String?
}

struct AnthropicToolUseContent: Codable {
    let type: String        // "tool_use"
    let id: String
    let name: String
    let input: AnyCodable
}

struct AnthropicToolResultContent: Codable {
    let type: String        // "tool_result"
    let tool_use_id: String
    let content: AnthropicToolResultValue
}

enum AnthropicToolResultValue: Codable {
    case text(String)
    case blocks([AnthropicTextContent])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { self = .text(s); return }
        if let b = try? c.decode([AnthropicTextContent].self) { self = .blocks(b); return }
        self = .text("")
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .text(let s): try c.encode(s)
        case .blocks(let b): try c.encode(b)
        }
    }

    var text: String {
        switch self {
        case .text(let s): return s
        case .blocks(let b): return b.map(\.text).joined(separator: "\n")
        }
    }
}

// MARK: - Non-streaming Response

struct AnthropicResponse: Codable {
    let id: String
    let type: String            // "message"
    let role: String            // "assistant"
    let content: [AnthropicResponseBlock]
    let model: String
    let stop_reason: String?    // "end_turn" | "max_tokens" | "stop_sequence" | "tool_use"
    let stop_sequence: String?
    let usage: AnthropicUsage
}

enum AnthropicResponseBlock: Codable {
    case text(AnthropicTextContent)
    case toolUse(AnthropicToolUseContent)

    private enum TypeKey: String, CodingKey { case type }

    init(from decoder: Decoder) throws {
        let kc = try decoder.container(keyedBy: TypeKey.self)
        let type = try kc.decode(String.self, forKey: .type)
        switch type {
        case "tool_use": self = .toolUse(try AnthropicToolUseContent(from: decoder))
        default:         self = .text(try AnthropicTextContent(from: decoder))
        }
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .text(let b):    try b.encode(to: encoder)
        case .toolUse(let b): try b.encode(to: encoder)
        }
    }
}

struct AnthropicUsage: Codable {
    let input_tokens: Int
    let output_tokens: Int
}

// MARK: - SSE Streaming Event Envelopes
// content_block and delta use AnyCodable to avoid encoding nil optional fields.

struct AnthropicMessageStartEvent: Codable {
    let type: String            // "message_start"
    let message: AnthropicStreamMessage
}

struct AnthropicStreamMessage: Codable {
    let id: String
    let type: String            // "message"
    let role: String            // "assistant"
    let content: [String]       // empty array at start
    let model: String
    let stop_reason: String?
    let stop_sequence: String?
    let usage: AnthropicUsage
}

struct AnthropicPingEvent: Codable {
    let type: String            // "ping"
}

struct AnthropicContentBlockStartEvent: Codable {
    let type: String            // "content_block_start"
    let index: Int
    let content_block: AnyCodable
}

struct AnthropicContentBlockDeltaEvent: Codable {
    let type: String            // "content_block_delta"
    let index: Int
    let delta: AnyCodable
}

struct AnthropicContentBlockStopEvent: Codable {
    let type: String            // "content_block_stop"
    let index: Int
}

struct AnthropicMessageDeltaEvent: Codable {
    let type: String            // "message_delta"
    let delta: AnthropicMessageDeltaPayload
    let usage: AnthropicStreamUsage
}

struct AnthropicMessageDeltaPayload: Codable {
    let stop_reason: String?
    let stop_sequence: String?
}

struct AnthropicStreamUsage: Codable {
    let output_tokens: Int
}

struct AnthropicMessageStopEvent: Codable {
    let type: String            // "message_stop"
}

// MARK: - Conversion: Anthropic → Internal

/// Convert an Anthropic /v1/messages request to the internal [ChatMessage] format.
func anthropicToInternalMessages(request: AnthropicRequest) -> [ChatMessage] {
    var messages: [ChatMessage] = []

    // System prompt becomes a leading system-role message
    if let system = request.system {
        messages.append(ChatMessage(role: "system", content: .string(system.text)))
    }

    for msg in request.messages {
        switch msg.content {
        case .text(let text):
            messages.append(ChatMessage(role: msg.role, content: .string(text)))

        case .blocks(let blocks):
            var textParts: [String] = []
            var imageUrls: [String] = []
            var toolCalls: [ToolCallInfo] = []
            var hasNonToolResult = false

            for block in blocks {
                switch block {
                case .text(let tc):
                    textParts.append(tc.text)
                    hasNonToolResult = true

                case .image(let ic):
                    let src = ic.source
                    if src.type == "url", let url = src.url {
                        imageUrls.append(url)
                    } else if src.type == "base64", let data = src.data, let mt = src.media_type {
                        imageUrls.append("data:\(mt);base64,\(data)")
                    }
                    hasNonToolResult = true

                case .toolUse(let tu):
                    // Serialize the input dict back to a JSON string for ToolCallInfo
                    let argsData = (try? JSONSerialization.data(withJSONObject: tu.input.value)) ?? Data()
                    let argsString = String(data: argsData, encoding: .utf8) ?? "{}"
                    toolCalls.append(ToolCallInfo(
                        id: tu.id,
                        type: "function",
                        function: FunctionCall(name: tu.name, arguments: argsString)
                    ))
                    hasNonToolResult = true

                case .toolResult(let tr):
                    // Tool results become separate tool-role messages
                    messages.append(ChatMessage(
                        role: "tool",
                        content: .string(tr.content.text),
                        tool_call_id: tr.tool_use_id
                    ))

                case .unknown:
                    break
                }
            }

            if hasNonToolResult {
                messages.append(ChatMessage(
                    role: msg.role,
                    content: .string(textParts.joined(separator: "\n")),
                    images: imageUrls.isEmpty ? nil : imageUrls,
                    tool_calls: toolCalls.isEmpty ? nil : toolCalls
                ))
            }
        }
    }

    return messages
}

/// Convert Anthropic tool definitions to OpenAI function-calling format,
/// which most open-source MLX models expect in their chat templates.
func anthropicToolsToOpenAI(_ tools: [AnyCodable]) -> [AnyCodable] {
    tools.compactMap { tool -> AnyCodable? in
        guard let dict = tool.value as? [String: Any] else { return tool }
        let name = dict["name"] as? String ?? ""
        let description = dict["description"] as? String ?? ""
        let inputSchema = dict["input_schema"] ?? [String: Any]()
        return AnyCodable([
            "type": "function",
            "function": [
                "name": name,
                "description": description,
                "parameters": inputSchema,
            ] as [String: Any],
        ] as [String: Any])
    }
}
